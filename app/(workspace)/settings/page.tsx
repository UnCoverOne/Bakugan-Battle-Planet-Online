import {redirect} from "next/navigation";

// Compatibility for old bookmarks. Settings is no longer a product page.
export default function SettingsPage(){redirect("/?settings=1");}
