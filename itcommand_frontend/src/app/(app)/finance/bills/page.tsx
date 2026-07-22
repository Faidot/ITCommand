import { redirect } from "next/navigation";

/** Compatibility route for the former bills URL. */
export default function BillsRedirect() {
  redirect("/finance/recurring-bills");
}
