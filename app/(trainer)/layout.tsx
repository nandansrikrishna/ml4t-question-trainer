import { connection } from "next/server";
import { getDailyDateKey } from "../../lib/daily-questions";
import Home from "../home";

export default async function TrainerLayout({ children }: { children: React.ReactNode }) {
  await connection();

  return (
    <>
      <Home dailyDateKey={getDailyDateKey(new Date())} />
      {children}
    </>
  );
}
