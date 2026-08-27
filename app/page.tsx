import { connection } from "next/server";
import { getDailyDateKey } from "../lib/daily-questions";
import Home from "./home";

export default async function Page() {
  await connection();

  return <Home dailyDateKey={getDailyDateKey(new Date())} />;
}
