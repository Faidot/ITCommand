import { redirect } from "next/navigation";

/** Compatibility route for old bookmarks and notification links. */
export default function NewTicketRedirect() {
  redirect("/helpdesk/tickets?new=1");
}
