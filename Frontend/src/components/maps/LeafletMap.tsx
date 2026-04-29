import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});
L.Marker.prototype.options.icon = DefaultIcon;

export type MapMarker = {
  id: string;
  entityId?: string;
  position: { lat: number; lng: number };
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
};

export type HeatmapPoint = { lat: number; lng: number; weight?: number };

type LeafletMapProps = {
  markers: MapMarker[];
  heatmapPoints?: HeatmapPoint[];
  showHeatmap?: boolean;
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: string;
};

const FitBounds = ({ markers }: { markers: MapMarker[] }) => {
  const map = useMap();

  useEffect(() => {
    if (markers.length > 0) {
      const bounds = L.latLngBounds(markers.map((m) => [m.position.lat, m.position.lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [markers, map]);

  return null;
};

const HeatmapLayer = ({ points, showHeatmap }: { points: HeatmapPoint[]; showHeatmap: boolean }) => {
  const map = useMap();

  useEffect(() => {
    if (!showHeatmap || points.length === 0) return;

    const heatPoints: [number, number, number][] = points.map((p) => [p.lat, p.lng, p.weight ?? 1]);
    
    const heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
    }).addTo(map);

    return () => {
      map.removeLayer(heatLayer);
    };
  }, [points, showHeatmap, map]);

  return null;
};

export const LeafletMap = ({
  markers,
  heatmapPoints = [],
  showHeatmap = false,
  center = { lat: 20.5937, lng: 78.9629 }, // Default to India center
  zoom = 5,
  height = '560px',
}: LeafletMapProps) => {
  return (
    <div style={{ height, width: '100%' }} className="w-full rounded-xl border border-border overflow-hidden z-0 isolation-auto">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {markers.map((marker) => (
          <Marker key={marker.id} position={[marker.position.lat, marker.position.lng]}>
            <Popup>
              <div className="text-sm">
                <div className="font-bold mb-1">{marker.title}</div>
                <div className="mb-1 text-xs text-muted-foreground">
                  ID: <span className="font-medium text-foreground">{marker.entityId || marker.id}</span>
                </div>
                {marker.description && <div className="mb-1">{marker.description}</div>}
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {marker.status && <span>Status: <span className="font-medium text-foreground">{marker.status}</span></span>}
                  {marker.priority && <span>Priority: <span className="font-medium text-foreground">{marker.priority}</span></span>}
                  {marker.type && <span>Type: <span className="font-medium text-foreground capitalize">{marker.type}</span></span>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBounds markers={markers} />
        <HeatmapLayer points={heatmapPoints} showHeatmap={showHeatmap} />
      </MapContainer>
    </div>
  );
};
