// The builder is now a panel inside the unified workspace. Keep the old URL
// working by redirecting to the workspace with the Build panel active.
import { redirect } from "react-router";

export function loader() {
  return redirect("/?panel=build");
}
