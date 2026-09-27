import MapApp from "@/components/map/MapApp";
import { getLatestKendal, getMapDecisions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [map, latest] = await Promise.all([getMapDecisions(), getLatestKendal(6)]);
  const status = map.status.ok ? latest.status : map.status;
  return <MapApp decisions={map.data} latest={latest.data} status={status} />;
}
