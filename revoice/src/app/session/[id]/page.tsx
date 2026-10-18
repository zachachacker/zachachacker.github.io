import { SessionScreen } from "@/components/session/SessionScreen";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionScreen id={id} />;
}
