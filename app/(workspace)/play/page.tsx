import type { Metadata } from "next";
import { PlayScreen } from "../../../components/routes/PlayRoutes";

export const metadata: Metadata = { title: "Play" };
export default function PlayPage() { return <PlayScreen />; }
