// import { useEffect, useRef, useState } from 'react';

// type MapMarker = {
//   id: string;
//   position: { lat: number; lng: number };
//   title: string;
//   description?: string;
//   status?: string;
//   priority?: string;
//   type?: string;
// };

// type GoogleMapProps = {
//   apiKey: string;
//   markers: MapMarker[];
//   heatmapPoints?: { lat: number; lng: number; weight?: number }[];
//   showHeatmap?: boolean;
//   center?: { lat: number; lng: number };
//   zoom?: number;
//   height?: string;
// };

// const escapeHtml = (value: string) => {
//   return value.replace(/[&<>"']/g, (ch) => {
//     if (ch === '&') return '&amp;';
//     if (ch === '<') return '&lt;';
//     if (ch === '>') return '&gt;';
//     if (ch === '"') return '&quot;';
//     return '&#039;';
//   });
// };

// export const GoogleMap = ({ apiKey, markers, heatmapPoints = [], showHeatmap = false, center, zoom = 12, height = '520px' }: GoogleMapProps) => {
//   const mapRef = useRef<HTMLDivElement | null>(null);
//   const mapInstanceRef = useRef<any>(null);
//   const markersRef = useRef<any[]>([]);
//   const heatmapRef = useRef<any>(null);
//   const [ready, setReady] = useState(false);
//   const [error, setError] = useState('');

//   useEffect(() => {
//     if (!apiKey) {
//       setError('Google Maps API key is required');
//       return;
//     }
//     if ((window as any).google?.maps) {
//       setReady(true);
//       return;
//     }
//     const existing = document.querySelector('script[data-google-maps="true"]') as HTMLScriptElement | null;
//     if (existing) {
//       existing.addEventListener('load', () => setReady(true));
//       existing.addEventListener('error', () => setError('Failed to load Google Maps'));
//       return;
//     }
//     const script = document.createElement('script');
//     script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=visualization`;
//     script.async = true;
//     script.defer = true;
//     script.dataset.googleMaps = 'true';
//     script.onload = () => setReady(true);
//     script.onerror = () => setError('Failed to load Google Maps');
//     document.head.appendChild(script);
//   }, [apiKey]);

//   useEffect(() => {
//     if (!ready || !mapRef.current) return;
//     const google = (window as any).google;
//     if (!google?.maps) return;
//     if (!mapInstanceRef.current) {
//       mapInstanceRef.current = new google.maps.Map(mapRef.current, {
//         center: center || { lat: 20.5937, lng: 78.9629 },
//         zoom
//       });
//     }
//   }, [ready, center, zoom]);

//   useEffect(() => {
//     if (!ready || !mapInstanceRef.current) return;
//     const google = (window as any).google;
//     if (!google?.maps) return;
//     markersRef.current.forEach((m) => m.setMap(null));
//     markersRef.current = [];
//     const infoWindow = new google.maps.InfoWindow();
//     const bounds = new google.maps.LatLngBounds();
//     markers.forEach((m) => {
//       const marker = new google.maps.Marker({
//         position: m.position,
//         map: mapInstanceRef.current,
//         title: m.title
//       });
//       marker.addListener('click', () => {
//         const content = `
//           <div style="max-width:240px">
//             <div style="font-weight:600;margin-bottom:4px">${escapeHtml(m.title)}</div>
//             ${m.description ? `<div style="margin-bottom:4px">${escapeHtml(m.description)}</div>` : ''}
//             ${m.status ? `<div>Status: ${escapeHtml(m.status)}</div>` : ''}
//             ${m.priority ? `<div>Priority: ${escapeHtml(m.priority)}</div>` : ''}
//             ${m.type ? `<div>Type: ${escapeHtml(m.type)}</div>` : ''}
//           </div>
//         `;
//         infoWindow.setContent(content);
//         infoWindow.open(mapInstanceRef.current, marker);
//       });
//       markersRef.current.push(marker);
//       bounds.extend(marker.getPosition());
//     });
//     if (markers.length > 0) {
//       mapInstanceRef.current.fitBounds(bounds);
//     }
//   }, [markers, ready]);

//   useEffect(() => {
//     if (!ready || !mapInstanceRef.current) return;
//     const google = (window as any).google;
//     if (!google?.maps?.visualization) return;
//     if (heatmapRef.current) {
//       heatmapRef.current.setMap(null);
//       heatmapRef.current = null;
//     }
//     if (!showHeatmap || heatmapPoints.length === 0) {
//       return;
//     }
//     const points = heatmapPoints.map((p) => ({
//       location: new google.maps.LatLng(p.lat, p.lng),
//       weight: p.weight || 1
//     }));
//     heatmapRef.current = new google.maps.visualization.HeatmapLayer({
//       data: points,
//       dissipating: true,
//       radius: 26,
//       opacity: 0.6
//     });
//     heatmapRef.current.setMap(mapInstanceRef.current);
//   }, [heatmapPoints, showHeatmap, ready]);

//   if (error) {
//     return (
//       <div className="w-full rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
//         {error}
//       </div>
//     );
//   }

//   return <div ref={mapRef} style={{ height }} className="w-full rounded-xl border border-border" />;
// };
