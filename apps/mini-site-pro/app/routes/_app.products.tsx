// Products is now a panel inside the unified workspace. Redirect the old URL.
import { redirect } from "react-router";

export function loader() {
  return redirect("/?panel=products");
}
