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


# The PDF's embedded math fonts do not expose reliable Unicode mappings.
# Keep narrowly scoped, source-specific repairs here so regenerating the bundled
# question data does not reintroduce corrupted equations.
TEXT_REPLACEMENTS = {
    "ML-D4G1Q6": (
        ("𝑦ො = 0.02 + 0.045𝑋ଵ − 0.012𝑋ଶ − 0.038𝑋ଷ", r"\[\hat y = 0.02 + 0.045X_1 - 0.012X_2 - 0.038X_3\]"),
    ),
    "ML-D4G3Q4": (
        ("𝑋,𝑋ଶ, … ,𝑋ଵହ", r"\(X, X^2, \ldots, X^{15}\)"),
    ),
    "ML-D4G3Q5": (
        (
            "෍ ( ௡ ௜ୀଵ 𝑦௜−𝑦ො௜)ଶ",
            r"\[\sum_{i=1}^{n} (y_i - \hat{y}_i)^2\]",
        ),
        ("𝑋, 𝑋ଶ, 𝑋ଷ, 𝑋ସ", r"\[X, X^2, X^3, X^4\]"),
        ("𝑋ସmay", r"\(X^4\) may"),
        ("𝑋or", r"\(X\) or"),
        ("𝑋ଶ", r"\(X^2\)"),
        ("𝑋ଷ", r"\(X^3\)"),
        ("𝑋ସ", r"\(X^4\)"),
        ("𝑋", r"\(X\)"),
        ("𝑦", r"\(y\)"),
    ),
    "ML-D4G4Q4": (
        ("𝑒௜ =𝑦௜−𝑦ො௜", r"\(e_i = y_i - \hat y_i\)"),
    ),
    "ML-D4G4Q5": (
        ("෍ 𝑒௜ଶ ௡ ௜ୀଵ", r"\[\sum_{i=1}^{n} e_i^2\]"),
        ("𝑒௜ =𝑦௜−𝑦ො௜", r"\(e_i = y_i - \hat y_i\)"),
    ),
    "ML-D4G4Q6": (
        ("𝔼[𝜖 ∣ 𝑋] = 0", r"\(\mathbb{E}[\epsilon \mid X] = 0\)"),
        ("𝑒௜ =𝑦௜−𝑦ො௜", r"\(e_i = y_i - \hat y_i\)"),
    ),
    "ML-D4G5Q4": (
        ("logቆ 𝑝(𝑋) 1 −𝑝(𝑋)ቇ =𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ +𝛽ଷ𝑋ଵ𝑋ଶ", r"\[\log\left(\frac{p(X)}{1-p(X)}\right)=\beta_0+\beta_1X_1+\beta_2X_2+\beta_3X_1X_2\]"),
        ("logቆ 𝑝(𝑋) 1 −𝑝(𝑋)ቇ =𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ", r"\[\log\left(\frac{p(X)}{1-p(X)}\right)=\beta_0+\beta_1X_1+\beta_2X_2\]"),
        ("𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ = logቀ 𝑐 1 −𝑐ቁ", r"\(\beta_0+\beta_1X_1+\beta_2X_2=\log\left(\frac{c}{1-c}\right)\)"),
        ("𝑋ଵ𝑋ଶ", r"\(X_1X_2\)"),
    ),
    "ML-D4G5Q5": (
        ("𝑦ො=𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ +𝛽ଷ𝑋ଵ𝑋ଶ", r"\[\hat y=\beta_0+\beta_1X_1+\beta_2X_2+\beta_3X_1X_2\]"),
        ("𝑦ො =𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ", r"\[\hat y=\beta_0+\beta_1X_1+\beta_2X_2\]"),
        ("𝑦ො=𝛽଴ +𝛽ଵ𝑋ଵ +𝛽ଶ𝑋ଶ", r"\(\hat y=\beta_0+\beta_1X_1+\beta_2X_2\)"),
        ("𝜕𝑦ො 𝜕𝑋ଶ =𝛽ଶ +𝛽ଷ𝑋ଵ", r"\(\frac{\partial \hat y}{\partial X_2}=\beta_2+\beta_3X_1\)"),
        ("𝜕𝑦ො 𝜕𝑋ଶ =𝛽ଶ", r"\(\frac{\partial \hat y}{\partial X_2}=\beta_2\)"),
        ("𝑋ଵ𝑋ଶ", r"\(X_1X_2\)"),
    ),
    "ML-D4G6Q4": (
        ("⎩⎪⎨ ⎪⎧ ා ቌ 𝑦௜−𝛽଴ −෍ 𝑥௜௝ ௣ ௝ୀଵ 𝛽௝ቍ ଶ௡ ௜ୀଵ +𝜆𝑃(𝛽) ⎭⎪⎬ ⎪⎫", r"\[\left\{\sum_{i=1}^{n}\left(y_i-\beta_0-\sum_{j=1}^{p}x_{ij}\beta_j\right)^2+\lambda P(\beta)\right\}\]"),
        ("𝜆෍ ∣ ௣ ௝ୀଵ 𝛽௝ ∣", r"\(\lambda\sum_{j=1}^{p}|\beta_j|\)"),
        ("𝜆෍ 𝛽௝ଶ ௣ ௝ୀଵ", r"\(\lambda\sum_{j=1}^{p}\beta_j^2\)"),
    ),
    "ML-D5G1Q5": (
        ("𝑑(𝑥,𝑦) =ඥ (𝑥ଵ −𝑦ଵ)ଶ +(𝑥ଶ −𝑦ଶ)ଶ", r"\[d(x,y)=\sqrt{(x_1-y_1)^2+(x_2-y_2)^2}\]"),
        ("𝑑(𝑥,𝑦) =∣𝑥ଵ −𝑦ଵ ∣ +∣𝑥ଶ −𝑦ଶ ∣", r"\[d(x,y)=|x_1-y_1|+|x_2-y_2|\]"),
    ),
    "ML-D5G1Q6": (
        ("𝑑(𝑎,𝑏)=ට ൫𝑋ଵ,௔ −𝑋ଵ,௕൯ଶ +൫𝑋ଶ,௔ −𝑋ଶ,௕൯ଶ +൫𝑋ଷ,௔ −𝑋ଷ,௕൯ଶ", r"\[d(a,b)=\sqrt{(X_{1,a}-X_{1,b})^2+(X_{2,a}-X_{2,b})^2+(X_{3,a}-X_{3,b})^2}\]"),
        ("cos(𝑎,𝑏) = 𝑎𝘛𝑏 ∥𝑎∥ଶ∥𝑏∥ଶ", r"\[\cos(a,b)=\frac{a^Tb}{\|a\|_2\|b\|_2}\]"),
        ("𝑧௜௝=𝑥௜௝−𝜇௝ 𝜎௝", r"\[z_{ij}=\frac{x_{ij}-\mu_j}{\sigma_j}\]"),
        ("𝑥norm= 𝑥−𝑥୫୧୬ 𝑥୫ୟ୶ −𝑥୫୧୬", r"\[x_{\mathrm{norm}}=\frac{x-x_{\min}}{x_{\max}-x_{\min}}\]"),
    ),
    "ML-D5G2Q6": (
        ("𝑓መ(𝑥଴) =1 𝐾 ෍ 𝑦௜ ௜∈𝒩಼ (௫బ)", r"\[\hat f(x_0)=\frac{1}{K}\sum_{i\in\mathcal{N}_K(x_0)}y_i\]"),
        ("𝑓መ(𝑥଴) =1 𝑁෍ 𝑦௜ ே ௜ୀଵ =𝑦ത", r"\[\hat f(x_0)=\frac{1}{N}\sum_{i=1}^{N}y_i=\bar y\]"),
    ),
    "ML-D5G4Q5": (
        ("𝑟௣", r"\(r^p\)"),
        ("𝑟 =𝑞ଵ/௣", r"\(r=q^{1/p}\)"),
        ("𝐷୫ୟ୶ −𝐷୫୧୬ 𝐷୫୧୬ → 0", r"\(\frac{D_{\max}-D_{\min}}{D_{\min}}\to0\)"),
        ("𝐷୫୧୬ 𝐷୫ୟ୶ → 1", r"\(\frac{D_{\min}}{D_{\max}}\to1\)"),
        ("𝑑ଶ(𝑥,𝑧) =෍ ( ௣ ௝ୀଵ 𝑥௝ −𝑧௝)ଶ", r"\[d^2(x,z)=\sum_{j=1}^{p}(x_j-z_j)^2\]"),
        ("𝑑ଵ(𝑥,𝑧) =෍ ∣ ௣ ௝ୀଵ 𝑥௝ −𝑧௝ ∣", r"\[d_1(x,z)=\sum_{j=1}^{p}|x_j-z_j|\]"),
    ),
    "ML-D5G5Q4": (
        ("𝜷∈ ℝ௣ାଵ", r"\(\boldsymbol{\beta}\in\mathbb{R}^{p+1}\)"),
    ),
    "ML-D6G1Q5": (
        ("𝑅ଵ(𝑗,𝑠) =൛𝑥:𝑥௝ ≤𝑠ൟ, 𝑅ଶ(𝑗,𝑠) =൛𝑥:𝑥௝ >𝑠ൟ", r"\[R_1(j,s)=\{x:x_j\le s\},\quad R_2(j,s)=\{x:x_j>s\}\]"),
        ("෍ ൫ 𝑦௜−𝑦തோభ൯ଶ ௫೔∈ோభ൫𝑗,𝑠൯ + ෍ ൫ 𝑦௜−𝑦തோమ൯ଶ ௫೔∈ோమ൫𝑗,𝑠൯", r"\[\sum_{x_i\in R_1(j,s)}(y_i-\bar y_{R_1})^2+\sum_{x_i\in R_2(j,s)}(y_i-\bar y_{R_2})^2\]"),
        ("𝑓መ(𝑥) =𝑦തோ೘ = 1 ∣ 𝑅௠ ∣ ෍ 𝑦௜ ௜:௫೔∈ோ೘", r"\[\hat f(x)=\bar y_{R_m}=\frac{1}{|R_m|}\sum_{i:x_i\in R_m}y_i\]"),
        ("𝑦ොnew∈ൣ𝑦୫୧୬,train,𝑦୫ୟ୶ ,train൧", r"\(\hat y_{\mathrm{new}}\in[y_{\min,\mathrm{train}},y_{\max,\mathrm{train}}]\)"),
    ),
    "ML-D6G1Q6": (
        ("𝐸௠ = 1 − max௞ (𝑝̂௠௞ )", r"\(E_m=1-\max_k(\hat p_{mk})\)"),
        ("𝑝̂௠ଵ =𝑝", r"\(\hat p_{m1}=p\)"),
        ("𝑝=𝑤௅𝑝௅ +𝑤ோ𝑝ோ", r"\(p=w_Lp_L+w_Rp_R\)"),
        ("𝐼(𝑝) ≥𝑤௅𝐼(𝑝௅)+𝑤ோ𝐼(𝑝ோ)", r"\(I(p)\ge w_LI(p_L)+w_RI(p_R)\)"),
        ("Δ𝐼 =𝐼(𝑝)−[𝑤௅𝐼(𝑝௅)+𝑤ோ𝐼(𝑝ோ)]", r"\(\Delta I=I(p)-[w_LI(p_L)+w_RI(p_R)]\)"),
    ),
    "ML-D6G3Q5": (
        ("MSEtrain= 0.000and 𝑅trainଶ = 1.000", r"\(\mathrm{MSE}_{\mathrm{train}}=0.000\) and \(R_{\mathrm{train}}^2=1.000\)"),
        ("𝑓መ(𝑥௜) =𝑦௜", r"\(\hat f(x_i)=y_i\)"),
        ("𝑓መ(𝑥) =𝑦തோ೘", r"\(\hat f(x)=\bar y_{R_m}\)"),
        ("𝑦തtrain", r"\(\bar y_{\mathrm{train}}\)"),
        ("logଶ(𝑝)", r"\(\log_2(p)\)"),
        ("logଶ(𝑁)", r"\(\log_2(N)\)"),
    ),
    "ML-D6G3Q6": (
        ("Training Error஺ = 0", r"\(\mathrm{Training\ Error}_A=0\)"),
        ("Training Error஻ ≥Training Error஺", r"\(\mathrm{Training\ Error}_B\ge\mathrm{Training\ Error}_A\)"),
    ),
    "ML-D6G4Q4": (
        ("Objective=Loss+𝜆Ω(𝛽)", r"\(\mathrm{Objective}=\mathrm{Loss}+\lambda\Omega(\beta)\)"),
    ),
    "ML-D6G4Q6": (
        ("2ଷ = 8", r"\(2^3=8\)"),
    ),
    "ML-D6G5Q6": (
        ("𝑋௝ ≤𝑠 ⟺ ln൫𝑋௝൯≤ ln(𝑠)", r"\(X_j\le s\Longleftrightarrow\ln(X_j)\le\ln(s)\)"),
    ),
    "ML-D6G6Q4": (
        ("𝑋௝ ≤𝑠 ⟺ ln൫𝑋௝൯≤ ln(𝑠)", r"\(X_j\le s\Longleftrightarrow\ln(X_j)\le\ln(s)\)"),
        ("𝑋ଶonly after an earlier split establishes that 𝑋ଵ >𝑠ଵ", r"\(X_2\) only after an earlier split establishes that \(X_1>s_1\)"),
    ),
    "ML-D6G6Q5": (
        ("𝑋௝ ≤𝑠 ⟺ ln൫𝑋௝൯≤ ln(𝑠)", r"\(X_j\le s\Longleftrightarrow\ln(X_j)\le\ln(s)\)"),
    ),
    "ML-D6G6Q6": (
        ("𝑋ଶonly within the branch where 𝑋ଵ >𝑠ଵ", r"\(X_2\) only within the branch where \(X_1>s_1\)"),
        ("𝑋ଵ𝑋ଶterm", r"\(X_1X_2\) term"),
    ),
    "ML-D6G7Q5": (
        ("𝑋ଵ +𝑋ଶ > 0", r"\(X_1+X_2>0\)"),
    ),
}


# Simple symbols recur across many fields. Complex expressions above are
# repaired first so these token-level replacements cannot fragment a formula.
GLOBAL_MATH_REPLACEMENTS = (
    ("𝑋ଵହ", r"\(X^{15}\)"),
    ("𝑋ଵ", r"\(X_1\)"),
    ("𝑋ଶ", r"\(X_2\)"),
    ("𝑋ଷ", r"\(X_3\)"),
    ("𝑅trainଶ", r"\(R_{\mathrm{train}}^2\)"),
    ("𝑅ଶ", r"\(R^2\)"),
    ("𝐿ଵ", r"\(L_1\)"),
    ("𝐿ଶ", r"\(L_2\)"),
    ("𝑋௝", r"\(X_j\)"),
    ("𝑅௠", r"\(R_m\)"),
    ("𝑦ො௜", r"\(\hat y_i\)"),
    ("𝑦௜", r"\(y_i\)"),
    ("𝛽଴", r"\(\beta_0\)"),
    ("𝛽ଵ", r"\(\beta_1\)"),
    ("𝛽ଶ", r"\(\beta_2\)"),
    ("𝛽ଷ", r"\(\beta_3\)"),
    ("𝜇௝", r"\(\mu_j\)"),
    ("𝜎௝", r"\(\sigma_j\)"),
    ("𝑥଴", r"\(x_0\)"),
    ("𝐷୫୧୬", r"\(D_{\min}\)"),
    ("𝐷୫ୟ୶", r"\(D_{\max}\)"),
    ("𝑤௅", r"\(w_L\)"),
    ("𝑤ோ", r"\(w_R\)"),
    ("𝑝௅", r"\(p_L\)"),
    ("𝑝ோ", r"\(p_R\)"),
)

AFFECTED_QUESTION_IDS = {
    "ML-D4G1Q6", "ML-D4G2Q4", "ML-D4G3Q4", "ML-D4G3Q5",
    "ML-D4G4Q4", "ML-D4G4Q5", "ML-D4G4Q6", "ML-D4G5Q4",
    "ML-D4G5Q5", "ML-D4G6Q4", "ML-D5G1Q5", "ML-D5G1Q6",
    "ML-D5G2Q6", "ML-D5G4Q5", "ML-D5G5Q4", "ML-D6G1Q5",
    "ML-D6G1Q6", "ML-D6G3Q5", "ML-D6G3Q6", "ML-D6G4Q4",
    "ML-D6G4Q6", "ML-D6G5Q5", "ML-D6G5Q6", "ML-D6G6Q4",
    "ML-D6G6Q5", "ML-D6G6Q6", "ML-D6G7Q4", "ML-D6G7Q5",
}


def clean(value: str) -> str:
    value = value.replace("\ufb01", "fi").replace("\ufb02", "fl").replace("Ư", "ff")
    value = value.replace("“", '"').replace("”", '"').replace("’", "'")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def repair_extracted_text(question_id: str, value: str) -> str:
    for extracted, replacement in TEXT_REPLACEMENTS.get(question_id, ()):
        value = value.replace(extracted, replacement)
    for extracted, replacement in GLOBAL_MATH_REPLACEMENTS:
        value = value.replace(extracted, replacement)
    if question_id in AFFECTED_QUESTION_IDS:
        value = value.replace("\uf0b7", "•")
    value = re.sub(r"\\\)(?=[A-Za-z0-9])", r"\\) ", value)
    return value


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
    prompt = repair_extracted_text(question_id, clean(front[: first_statement.start()]))

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
            "text": repair_extracted_text(question_id, clean(statement_match.group(1))),
            "answer": answer_match.group(1).lower() == "true",
            "explanation": repair_extracted_text(question_id, clean(answer_match.group(2))),
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

bad_math_glyph = re.compile(r"[\u0B00-\u0DFF\u1200-\u137F\u23A7-\u23AD]")
corrupt_question_ids = sorted({
    question["id"]
    for question in questions
    for value in (
        question["prompt"],
        *(statement[field] for statement in question["statements"] for field in ("text", "explanation")),
    )
    if bad_math_glyph.search(value)
})
if corrupt_question_ids:
    raise ValueError(f"Unrepaired embedded-font math in: {', '.join(corrupt_question_ids)}")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(questions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Wrote {len(questions)} questions to {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
