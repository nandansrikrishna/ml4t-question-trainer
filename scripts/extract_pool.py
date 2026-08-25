from __future__ import annotations

import bisect
import json
import re
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "ML4T Exam Question Pool.pdf"
OUTPUT = ROOT / "app" / "data" / "questions.json"

SECTIONS = {
    "ML": {
        "exam": 1,
        "area": "Machine Learning",
        "starts": [12, 41, 67, 100, 132, 165, 205, 223, 236, 249],
        "titles": [
            "Learning Paradigms & Problem Framing", "Data & Sampling Discipline",
            "Feature Engineering & Leakage", "Linear Models & Regression",
            "Instance-Based Learning (KNN)", "Decision Trees", "Ensemble Methods",
            "Model Evaluation & Metrics", "Overfitting, Underfitting & Generalization",
            "Model Selection & Practical Tradeoffs",
        ],
    },
    "QF": {
        "exam": 1,
        "area": "Quantitative Finance",
        "starts": [271, 286, 301, 316, 331, 346, 361, 376, 391, 406],
        "titles": [
            "Investment Returns and Compounding", "Risk and Risk-Adjusted Performance",
            "Diversification and Correlation", "Portfolio Optimization",
            "Market Microstructure and Trade Execution", "Valuation and Mispricing",
            "CAPM, Alpha, Beta, and Hedging", "Market Efficiency and Arbitrage",
            "Financial Data and Research Bias", "Quantitative Strategy Design and Evaluation",
        ],
    },
    "ML2": {
        "exam": 2,
        "area": "Machine Learning",
        "starts": [427, 443, 459, 474, 489, 504, 520, 535, 551, 566],
        "titles": [
            "Reinforcement Learning Problem Framing", "Markov Decision Processes, Policies, and Values",
            "Q-Learning Mechanics", "Exploration, Exploitation, and Learning Dynamics",
            "Dyna and Model-Based Reinforcement Learning",
            "State Representation, Discretization, and Reward Design",
            "Reinforcement Learning for Trading", "Comparative Strategy Learning and Evaluation",
            "Deep Learning and Neural-Network Foundations",
            "Sequential, Generative, and Responsible AI",
        ],
    },
    "QF2": {
        "exam": 2,
        "area": "Quantitative Finance",
        "starts": [586, 603, 620, 637, 654, 671, 687, 704, 721, 737],
        "titles": [
            "Financial Time Series and Market Data Behavior", "Technical Indicators and Signal Construction",
            "Alpha Research and Formulaic Signals", "Fundamental Law of Active Portfolio Management",
            "Advanced Portfolio Construction", "Strategy Evaluation and Performance Attribution",
            "Trading Frictions, Capacity, and Implementability",
            "Execution Algorithms and Order Book Analytics", "Options and Derivative Payoffs",
            "AI-Enabled Investment Processes and Decision Support",
        ],
    },
}


def clean(value: str) -> str:
    value = value.replace("\ufb01", "fi").replace("\ufb02", "fl").replace("Ư", "ff")
    value = value.replace("“", '"').replace("”", '"').replace("’", "'")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", " ", value)
    return re.sub(r"\s+", " ", value).strip()


reader = PdfReader(SOURCE)
pages: list[str] = []
page_offsets: list[int] = []
cursor = 0
for page_number, page in enumerate(reader.pages, start=1):
    text = page.extract_text() or ""
    text = re.sub(r"^\s*\d+\s+Rev:\d+\s*$", "", text, flags=re.MULTILINE)
    text = text.replace("\ufb01", "fi").replace("\ufb02", "fl").replace("Ư", "ff")
    page_offsets.append(cursor)
    pages.append(text)
    cursor += len(text) + 1

full_text = "\n".join(pages)
id_pattern = re.compile(r"\[((?:ML2?|QF2?)-D\d+G\d+Q\d+)\]")
matches = list(id_pattern.finditer(full_text))

# Domain introductions list every topic group before the first question.
group_names: dict[tuple[str, int, int], str] = {}
for prefix, section in SECTIONS.items():
    for domain_index, start_page in enumerate(section["starts"], start=1):
        first_question_page = start_page
        marker = re.compile(rf"\[{re.escape(prefix)}-D{domain_index}G\d+Q\d+\]")
        while first_question_page <= len(pages) and not marker.search(pages[first_question_page - 1]):
            first_question_page += 1
        intro_text = "\n".join(pages[start_page - 1:first_question_page])
        for group_number, title in re.findall(r"(?:^|\n)G(\d+):\s*([^\n]+)", intro_text):
            group_names[(prefix, domain_index, int(group_number))] = clean(title)

questions = []
for index, match in enumerate(matches):
    question_id = match.group(1)
    end = matches[index + 1].start() if index + 1 < len(matches) else len(full_text)
    chunk = full_text[match.end():end]
    key_split = re.split(r"\nAnswer Key(?:\s*\([^\n]*\))?\s*:\s*\n", chunk, maxsplit=1)
    if len(key_split) != 2:
        raise ValueError(f"Answer key not found for {question_id}")
    front, answer_key = key_split

    statements = []
    first_statement = re.search(r"(?:^|\n)A\.\s+", front)
    if not first_statement:
        raise ValueError(f"Statements not found for {question_id}")
    prompt = clean(front[: first_statement.start()])

    for letter in "ABCDE":
        statement_match = re.search(
            rf"(?:^|\n){letter}\.\s+(.*?)(?=\n[A-E]\.\s+|\Z)", front, re.DOTALL
        )
        answer_match = re.search(
            rf"(?:^|\n){letter}\.\s+(True|False)\s*[–-]\s*(.*?)(?=\n[A-E]\.\s+(?:True|False)\s*[–-]|\Z)",
            answer_key,
            re.DOTALL | re.IGNORECASE,
        )
        if not statement_match or not answer_match:
            raise ValueError(f"Could not parse statement {letter} for {question_id}")
        statements.append({
            "label": letter,
            "text": clean(statement_match.group(1)),
            "answer": answer_match.group(1).lower() == "true",
            "explanation": clean(answer_match.group(2)),
        })

    prefix, domain_raw, group_raw, _ = re.match(
        r"(ML2?|QF2?)-D(\d+)G(\d+)Q(\d+)", question_id
    ).groups()
    domain_index = int(domain_raw)
    group_index = int(group_raw)
    section = SECTIONS[prefix]
    page_number = bisect.bisect_right(page_offsets, match.start())

    questions.append({
        "id": question_id,
        "exam": section["exam"],
        "area": section["area"],
        "domainIndex": domain_index,
        "domain": section["titles"][domain_index - 1],
        "groupIndex": group_index,
        "group": group_names.get((prefix, domain_index, group_index), f"Topic Group {group_index}"),
        "page": page_number,
        "negated": bool(re.search(r"True if (?:it is )?incorrect", prompt, re.IGNORECASE)),
        "prompt": prompt,
        "statements": statements,
    })

if len(questions) != 938:
    raise ValueError(f"Expected 938 questions, parsed {len(questions)}")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {len(questions)} questions to {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
