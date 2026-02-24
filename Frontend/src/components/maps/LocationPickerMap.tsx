import { useEffect } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

export type PickedLocation = {
  lat: number;
  lon: number;
};

type LocationPickerMapProps = {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
  height?: string;
};

const RecenterMap = ({ value }: { value: PickedLocation | null }) => {
  const map = useMap();

  useEffect(() => {
    if (!value) {
      return;
    }

    const nextZoom = Math.max(map.getZoom(), 15);
    map.setView([value.lat, value.lon], nextZoom);
  }, [map, value]);

  return null;
};

const MapClickHandler = ({
  value,
  onChange,
}: {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
}) => {
  useMapEvents({
    click: (event) => {
      onChange({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });

  if (!value) {
    return null;
  }

  return (
    <Marker position={[value.lat, value.lon]}>
      <Popup>
        Selected: {value.lat.toFixed(6)}, {value.lon.toFixed(6)}
      </Popup>
    </Marker>
  );
};

export const LocationPickerMap = ({ value, onChange, height = '340px' }: LocationPickerMapProps) => {
  const fallback = { lat: 20.2961, lon: 85.8245 };
  const center = value || fallback;

  return (
    <div
      style={{ height, width: '100%' }}
      className="w-full overflow-hidden rounded-xl border border-border z-0 isolation-auto"
    >
      <MapContainer center={[center.lat, center.lon]} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler value={value} onChange={onChange} />
        <RecenterMap value={value} />
      </MapContainer>
    </div>
  );
};
