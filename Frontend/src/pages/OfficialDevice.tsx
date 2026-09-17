import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import {
  Cpu,
  Wifi,
  WifiOff,
  Radio,
  Navigation,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  Sliders,
  RefreshCw,
  Lock,
  Unlock,
  Server,
  Database,
  Thermometer,
  Zap,
  ChevronRight,
  Info,
  MapPin,
  Eye,
  EyeOff,
  Search,
  ArrowRight,
  AlertCircle,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { LeafletMap } from '@/components/maps/LeafletMap';
import { authService } from '@/services/auth';
import { apiClient } from '@/services/api';
import { API_ENDPOINTS } from '@/config/api';

interface DeviceTelemetry {
  device_id: string;
  device_name: string;
  timestamp: number;
  hardware: {
    cpu_temperature_c: number | null;
    temperature_warning: boolean;
    cpu_percent: number | null;
    memory_percent: number | null;
    memory_used_mb: number | null;
    memory_total_mb: number | null;
    disk_percent: number | null;
  };
  gps: {
    latitude: number | null;
    longitude: number | null;
    altitude_m: number | null;
    speed_kmh: number | null;
    heading_deg: number | null;
    satellites: number;
    hdop: number | null;
    fix_quality: number;
    has_fix: boolean;
    source: string;
  };
  camera: {
    connected: boolean;
    backend: string;
    resolution: string;
    fps_actual: number;
    target_fps: number;
    total_frames: number;
  };
  ml_detector: {
    model_loaded: boolean;
    model_path: string;
    confidence_threshold: number;
    last_latency_ms: number;
    total_detections: number;
  };
  server_sync: {
    pending_in_queue: number;
    synced_to_server: number;
    total_recorded: number;
    sync_failures: number;
    server_reachable: boolean;
    sync_enabled: boolean;
    server_url: string;
  };
  wifi_hotspot?: {
    ssid: string;
    ip: string;
    port: number;
  };
}

interface EdgeIncident {
  event_id: string;
  category: string;
  title: string;
  description: string;
  department: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  latitude: number | null;
  longitude: number | null;
  captured_at: string;
  snapshot_url?: string;
  status: 'pending' | 'synced' | 'failed' | 'rejected';
  timestamp: number;
}

interface DiscoveredDevice {
  id: string;
  name: string;
  ssid: string;
  url: string;
  ip: string;
  signalStrength: 'Strong' | 'Good' | 'Fair';
  isOnline: boolean;
  token?: string;
}

const REGISTERED_DEVICES_KEY = 'safelive_registered_devices';

export default function OfficialDevice() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const role = (currentUser?.officialRole || '').toLowerCase().replace('-', '_');
  const isAuthorized = role === 'field_inspector' || role === 'supervisor';

  // Device & Wi-Fi Pairing State
  const [availableDevices, setAvailableDevices] = useState<DiscoveredDevice[]>([]);
  const [registeredDevices, setRegisteredDevices] = useState<DiscoveredDevice[]>(() => {
    try { return JSON.parse(localStorage.getItem(REGISTERED_DEVICES_KEY) || '[]'); } catch { return []; }
  });
  const [selectedDevice, setSelectedDevice] = useState<DiscoveredDevice | null>(null);
  const [devicePassword, setDevicePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isDiscoveryModalOpen, setIsDiscoveryModalOpen] = useState(false);
  const [openDeviceMenu, setOpenDeviceMenu] = useState<string | null>(null);

  // Active Device State
  const [activeDevice, setActiveDevice] = useState<DiscoveredDevice | null>(() => {
    const saved = localStorage.getItem('safelive_active_device');
    return saved ? JSON.parse(saved) : null;
  });
  const [isConnected, setIsConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<DeviceTelemetry | null>(null);
  const [incidents, setIncidents] = useState<EdgeIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<EdgeIncident | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.45);
  const [serverSyncEnabled, setServerSyncEnabled] = useState<boolean>(true);

  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    setAvailableDevices(registeredDevices);
  }, []);

  // Scan network for broadcasting RPi 5 devices
  const scanForDevices = async () => {
    setIsScanning(true);
    try {
      const response = await apiClient.get<DiscoveredDevice[]>('/iot/discover');
      const checkedDevices = response.success && Array.isArray(response.data)
        ? response.data.map((device) => ({ ...device, signalStrength: 'Strong' as const }))
        : [];
      const discoveredIds = new Set(checkedDevices.map((device) => device.id));
      setAvailableDevices([...checkedDevices, ...registeredDevices.filter((device) => !discoveredIds.has(device.id))]);
      setIsDiscoveryModalOpen(true);
      toast({
        title: 'Wi-Fi Scan Complete',
        description: checkedDevices.length
          ? `Found ${checkedDevices.length} nearby Raspberry Pi 5 Wi-Fi network(s).`
          : 'No Raspberry Pi 5 Wi-Fi networks were found. Make sure the devices are powered on and advertising discovery.',
      });
    } catch (error) {
      toast({ title: 'Wi-Fi scan failed', description: error instanceof Error ? error.message : 'Could not scan the local network.', variant: 'destructive' });
    } finally {
      setIsScanning(false);
    }
  };

  // Connect & authenticate to selected RPi 5
  const handleConnectDevice = async () => {
    if (!selectedDevice) return;
    if (selectedDevice.token) {
      setActiveDevice(selectedDevice);
      setIsConnected(true);
      setIsConnectModalOpen(false);
      await fetchRealData(selectedDevice.url);
      return;
    }
    if (!devicePassword.trim()) {
      toast({ title: 'Password Required', description: 'Please enter the device security password.', variant: 'destructive' });
      return;
    }

    setIsConnecting(true);
    try {
      const authRes = await fetch(`${selectedDevice.url}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: devicePassword.trim(), deviceId: selectedDevice.id }),
      });

      if (!authRes.ok) {
        throw new Error('Invalid device password. Please verify and try again.');
      }

      const registered: DiscoveredDevice = { ...selectedDevice };
      const authPayload = await authRes.clone().json().catch(() => ({}));
      registered.token = authPayload.token;
      const nextRegistered = [...registeredDevices.filter((device) => device.id !== registered.id), registered];
      setRegisteredDevices(nextRegistered);
      localStorage.setItem(REGISTERED_DEVICES_KEY, JSON.stringify(nextRegistered));
      setActiveDevice(registered);
      setIsConnected(true);
      setIsConnectModalOpen(false);
      localStorage.setItem('safelive_active_device', JSON.stringify(registered));

      toast({
        title: 'Device Paired Successfully',
        description: `Connected to ${selectedDevice.name} over Wi-Fi.`,
      });

      // Initial data fetch
      await fetchRealData(selectedDevice.url);
    } catch (err: any) {
      toast({
        title: 'Connection Failed',
        description: err?.message || 'Could not connect to the IoT device. Ensure you are on the device Wi-Fi network.',
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const removeDevice = (deviceId: string) => {
    const next = registeredDevices.filter((device) => device.id !== deviceId);
    setRegisteredDevices(next);
    localStorage.setItem(REGISTERED_DEVICES_KEY, JSON.stringify(next));
    if (activeDevice?.id === deviceId) handleDisconnect();
    setAvailableDevices((devices) => devices.filter((device) => device.id !== deviceId));
    toast({ title: 'Device removed', description: 'The saved device registration was deleted.' });
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setActiveDevice(null);
    setTelemetry(null);
    localStorage.removeItem('safelive_active_device');
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current);
    }
    toast({ title: 'Disconnected', description: 'Disconnected from IoT device.' });
  };

  // Fetch actual real-time telemetry and incidents
  const fetchRealData = async (deviceBaseUrl: string) => {
    try {
      // 1. Fetch real device status
      const headers = (activeDevice?.token || registeredDevices.find((device) => device.url === deviceBaseUrl)?.token)
        ? { Authorization: `Bearer ${activeDevice?.token || registeredDevices.find((device) => device.url === deviceBaseUrl)?.token}` }
        : undefined;
      const statusRes = await fetch(`${deviceBaseUrl}/api/status`, { headers }).then((r) => (r.ok ? r.json() : null));
      if (statusRes) {
        setTelemetry(statusRes);
        if (statusRes.ml_detector?.confidence_threshold !== undefined) {
          setConfidenceThreshold(statusRes.ml_detector.confidence_threshold);
        }
        if (statusRes.server_sync?.sync_enabled !== undefined) {
          setServerSyncEnabled(statusRes.server_sync.sync_enabled);
        }
      }

      // 2. Fetch real incidents reported by the edge device
      const edgeIncidentsRes = await fetch(`${deviceBaseUrl}/api/incidents?limit=50`, { headers }).then((r) => (r.ok ? r.json() : null));
      let deviceIncidents: EdgeIncident[] = [];
      if (edgeIncidentsRes && Array.isArray(edgeIncidentsRes.incidents)) {
        deviceIncidents = edgeIncidentsRes.incidents;
      }

      // 3. Also fetch central server verified incidents
      try {
        const centralRes = await apiClient.get<any[]>(API_ENDPOINTS.INCIDENTS.LIST);
        if (centralRes.success && Array.isArray(centralRes.data)) {
          const iotIncidents = centralRes.data
            .filter((i) => i.reporterUserType === 'iot' || i.source === 'edge' || i.source === 'rpi5_edge' || i.deviceId)
            .map((i) => ({
              event_id: i.eventId || i.id || i.incidentId,
              category: i.category || 'civic_issue',
              title: i.title || 'IoT Detected Incident',
              description: i.description || '',
              department: i.department || 'Municipal Department',
              severity: (i.severity || 'high').toLowerCase() as any,
              confidence: i.confidence || 0.9,
              latitude: typeof i.latitude === 'number' ? i.latitude : null,
              longitude: typeof i.longitude === 'number' ? i.longitude : null,
              captured_at: i.createdAt || new Date().toISOString(),
              snapshot_url: i.images && i.images[0] ? i.images[0] : undefined,
              status: 'synced' as const,
              timestamp: new Date(i.createdAt || Date.now()).getTime() / 1000,
            }));

          // Merge by event_id deduplicating
          const existingIds = new Set(deviceIncidents.map((d) => d.event_id));
          for (const item of iotIncidents) {
            if (!existingIds.has(item.event_id)) {
              deviceIncidents.push(item);
            }
          }
        }
      } catch {
        // Central API unreachable, continue with device incidents
      }

      setIncidents(deviceIncidents);
    } catch (err) {
      console.debug('Error fetching real data:', err);
    }
  };

  // Polling hook when connected
  useEffect(() => {
    if (!isConnected || !activeDevice) return;

    fetchRealData(activeDevice.url);
    pollIntervalRef.current = window.setInterval(() => {
      fetchRealData(activeDevice.url);
    }, 2500);

    return () => {
      if (pollIntervalRef.current) {
        window.clearInterval(pollIntervalRef.current);
      }
    };
  }, [isConnected, activeDevice]);

  // Update edge parameters
  const handleUpdateConfig = async (newConf?: number, newSync?: boolean) => {
    if (!isConnected || !activeDevice) return;
    try {
      await fetch(`${activeDevice.url}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confidence_threshold: newConf !== undefined ? newConf : confidenceThreshold,
          server_sync_enabled: newSync !== undefined ? newSync : serverSyncEnabled,
        }),
      });
      toast({ title: 'Config Updated', description: 'Updated detection settings on Raspberry Pi 5.' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update edge settings.', variant: 'destructive' });
    }
  };

  // Map markers from actual reported incidents and real GPS
  const mapMarkers = useMemo(() => {
    const markers: any[] = [];
    if (telemetry?.gps && telemetry.gps.latitude != null && telemetry.gps.longitude != null) {
      markers.push({
        id: 'rpi5-pos',
        position: { lat: telemetry.gps.latitude, lng: telemetry.gps.longitude },
        title: `Vehicle Location: ${activeDevice?.name || 'RPi 5'}`,
        description: `Speed: ${telemetry.gps.speed_kmh ?? 0} km/h | Satellites: ${telemetry.gps.satellites ?? 0}`,
        priority: 'high',
        type: 'rpi5_device',
      });
    }

    incidents.forEach((inc) => {
      if (typeof inc.latitude === 'number' && typeof inc.longitude === 'number') {
        markers.push({
          id: inc.event_id,
          position: { lat: inc.latitude, lng: inc.longitude },
          title: inc.title,
          description: `${inc.department} • Severity: ${inc.severity.toUpperCase()}`,
          priority: inc.severity,
          type: inc.category,
        });
      }
    });

    return markers;
  }, [telemetry, incidents, activeDevice]);

  const mapCenter = useMemo(() => {
    if (telemetry?.gps && telemetry.gps.latitude && telemetry.gps.longitude) {
      return { lat: telemetry.gps.latitude, lng: telemetry.gps.longitude };
    }
    if (incidents.length > 0 && incidents[0].latitude != null && incidents[0].longitude != null) {
      return { lat: incidents[0].latitude, lng: incidents[0].longitude };
    }
    return undefined;
  }, [telemetry, incidents]);

  // Access Control Guard
  if (!isAuthorized) {
    return (
      <OfficialDashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
          <div className="p-4 rounded-2xl bg-amber-500/10 text-amber-500">
            <AlertCircle className="h-12 w-12" />
          </div>
          <h2 className="text-2xl font-bold font-heading text-foreground">Field Supervisor Access Only</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            The IoT Device inspection interface is strictly restricted to Field Supervisors and Field Inspectors. Verified civic incidents are automatically logged and viewable in the Tickets, Live Map, and Alerts portals.
          </p>
          <Button onClick={() => navigate('/official/dashboard')} className="mt-2">
            Return to Dashboard
          </Button>
        </div>
      </OfficialDashboardLayout>
    );
  }

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 pb-12">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-5 rounded-2xl border border-border shadow-sm">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-heading text-foreground">IoT Field Devices & Incident Stream</h1>
              <Badge variant={isConnected ? 'default' : 'outline'} className={isConnected ? 'bg-emerald-600' : 'text-muted-foreground'}>
                {isConnected ? 'Device Connected' : 'Wi-Fi Standby'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect to vehicle-mounted Raspberry Pi 5 units over Wi-Fi. Real-time detected incidents are logged below.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={scanForDevices} disabled={isScanning}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isScanning ? 'animate-spin' : ''}`} />
              Scan Wi-Fi
            </Button>
            {isConnected && (
              <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                <WifiOff className="h-4 w-4 mr-1.5" />
                Disconnect
              </Button>
            )}
          </div>
        </div>

        {/* 1. Available Devices Located Over Wi-Fi */}
        <Card className="border-border shadow-sm bg-card">
          <CardHeader className="p-4 border-b border-border bg-muted/20 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              <div>
                <CardTitle className="text-sm font-semibold">Available Devices Emitted Over Wi-Fi</CardTitle>
                <CardDescription className="text-xs">
                  Select a Raspberry Pi 5 unit broadcasting on the local Wi-Fi network and enter password to connect
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="text-xs">
              {availableDevices.length} Discovered
            </Badge>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {availableDevices.map((dev) => {
                const isThisConnected = isConnected && activeDevice?.id === dev.id;
                return (
                  <div
                    key={dev.id}
                    className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                      isThisConnected
                        ? 'border-emerald-500 bg-emerald-500/5 shadow-sm'
                        : 'border-border/80 bg-muted/10 hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-lg ${isThisConnected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-primary/10 text-primary'}`}>
                          <Radio className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">{dev.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{dev.ssid}</p>
                        </div>
                      </div>
                      <div className="relative flex items-center gap-1">
                        <Badge variant="outline" className={`text-[10px] ${isThisConnected ? 'text-emerald-600 border-emerald-500/40 font-bold' : ''}`}>
                          {isThisConnected ? 'Connected' : dev.signalStrength}
                        </Badge>
                        {registeredDevices.some((device) => device.id === dev.id) && (
                          <button
                            type="button"
                            aria-label={`Actions for ${dev.name}`}
                            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setOpenDeviceMenu(openDeviceMenu === dev.id ? null : dev.id)}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        )}
                        {openDeviceMenu === dev.id && (
                          <div className="absolute right-0 top-8 z-20 min-w-32 rounded-md border border-border bg-card p-1 shadow-lg">
                            <button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10" onClick={() => { setOpenDeviceMenu(null); removeDevice(dev.id); }}>
                              Remove device
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      <div className="flex justify-between">
                        <span>Wi-Fi network:</span>
                        <span className="text-emerald-500 font-medium">Discovered nearby</span>
                      </div>
                    </div>

                    <div>
                      {isThisConnected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={handleDisconnect}
                        >
                          Disconnect Unit
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="w-full text-xs bg-primary hover:bg-primary/90"
                          onClick={() => {
                            setSelectedDevice(dev);
                            if (dev.token) {
                              setActiveDevice(dev);
                              setIsConnected(true);
                              localStorage.setItem('safelive_active_device', JSON.stringify(dev));
                            } else {
                              setDevicePassword('');
                              setIsConnectModalOpen(true);
                            }
                          }}
                        >
                          {dev.token ? <Unlock className="h-3 w-3 mr-1.5" /> : <Lock className="h-3 w-3 mr-1.5" />}
                          {dev.token ? 'Open Device' : 'Connect Device'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 2. Connected Device Real-Time Telemetry (Only real data when connected) */}
        {isConnected && telemetry && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border p-4 bg-card shadow-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>CPU Temperature</span>
                <Thermometer className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-xl font-bold font-mono text-foreground">
                {telemetry.hardware?.cpu_temperature_c != null ? `${telemetry.hardware.cpu_temperature_c}°C` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {telemetry.hardware?.temperature_warning ? '⚠️ High temperature' : 'Hardware normal'}
              </p>
            </Card>

            <Card className="border-border p-4 bg-card shadow-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>System CPU Load</span>
                <Zap className="h-4 w-4 text-amber-500" />
              </div>
              <p className="text-xl font-bold font-mono text-foreground">
                {telemetry.hardware?.cpu_percent != null ? `${telemetry.hardware.cpu_percent}%` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">Quad-core Cortex-A76</p>
            </Card>

            <Card className="border-border p-4 bg-card shadow-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>GPS Fix & Satellites</span>
                <Navigation className="h-4 w-4 text-primary" />
              </div>
              <p className="text-xl font-bold font-mono text-foreground">
                {telemetry.gps?.has_fix ? `${telemetry.gps.satellites} Sats` : 'Acquiring...'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {telemetry.gps?.latitude != null && telemetry.gps?.longitude != null
                  ? `${telemetry.gps.latitude.toFixed(4)}, ${telemetry.gps.longitude.toFixed(4)}`
                  : 'Awaiting satellite lock'}
              </p>
            </Card>

            <Card className="border-border p-4 bg-card shadow-sm">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Cloud Sync Queue</span>
                <Server className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-xl font-bold font-mono text-foreground">
                {telemetry.server_sync?.synced_to_server ?? 0} Synced
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {telemetry.server_sync?.pending_in_queue ?? 0} pending in edge buffer
              </p>
            </Card>
          </div>
        )}

        {/* 3. Real Reported Incidents Feed & Map */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Incidents Feed List */}
          <div className="lg:col-span-8 space-y-4">
            <Card className="h-[420px] border-border shadow-sm bg-card flex flex-col">
              <CardHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Verified Incidents Reported by RPi 5
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Civic issues detected by YOLOv8, tagged with GPS coordinates, and transmitted to central server
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {incidents.length} Reported
                </Badge>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                {incidents.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground text-sm space-y-2">
                    <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500/60" />
                    <p className="font-semibold text-foreground">No Incidents Reported Yet</p>
                    <p className="text-xs max-w-sm mx-auto">
                      As the patrol vehicle moves, YOLOv8 will inspect the live footage and only verified civic hazards (potholes, garbage dumps, leaks) will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/60 max-h-[500px] overflow-y-auto">
                    {incidents.map((inc) => (
                      <div
                        key={inc.event_id}
                        className="p-4 hover:bg-muted/30 transition-colors flex items-center justify-between gap-4 cursor-pointer"
                        onClick={() => setSelectedIncident(inc)}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          {inc.snapshot_url ? (
                            <img
                              src={inc.snapshot_url.startsWith('http') ? inc.snapshot_url : `${activeDevice?.url || ''}${inc.snapshot_url}`}
                              alt={inc.title}
                              className="h-14 w-20 rounded-lg object-cover bg-black shrink-0 border border-border"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                              <AlertTriangle className="h-6 w-6 text-primary" />
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-foreground truncate">{inc.title}</span>
                              <Badge
                                variant="outline"
                                className={`text-[10px] uppercase font-bold shrink-0 ${
                                  inc.severity === 'critical'
                                    ? 'text-red-500 border-red-500/40'
                                    : inc.severity === 'high'
                                    ? 'text-orange-500 border-orange-500/40'
                                    : 'text-amber-500 border-amber-500/40'
                                }`}
                              >
                                {inc.severity}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{inc.description}</p>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/80 mt-1">
                              {inc.latitude != null && inc.longitude != null && (
                                <span className="flex items-center gap-1 font-mono">
                                  <MapPin className="h-3 w-3 text-primary" />
                                  {inc.latitude.toFixed(5)}, {inc.longitude.toFixed(5)}
                                </span>
                              )}
                              <span>•</span>
                              <span>Confidence: {(inc.confidence * 100).toFixed(0)}%</span>
                              <span>•</span>
                              <span>{new Date(inc.timestamp * 1000).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          <Badge variant="default" className="text-[10px] bg-emerald-600">
                            Synced to Cloud
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* GPS Patrol Map */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="h-[420px] border-border shadow-sm bg-card overflow-hidden flex flex-col">
              <CardHeader className="p-4 border-b border-border bg-muted/20">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-primary" />
                    Patrol Route & Incident Map
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {telemetry?.gps?.has_fix ? `${telemetry.gps.satellites} Sats` : 'Live Map'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 h-[340px] flex-1 min-h-0">
                <LeafletMap markers={mapMarkers} center={mapCenter} zoom={14} height="340px" />
              </CardContent>
            </Card>

            {/* Edge Threshold Configuration (Only when connected) */}
            {isConnected && (
              <Card className="border-border shadow-sm bg-card">
                <CardHeader className="p-4 border-b border-border">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-primary" />
                    Live Edge Parameters
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-4 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="font-medium text-foreground">YOLO Confidence Threshold</span>
                      <span className="font-mono text-primary font-bold">{(confidenceThreshold * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[confidenceThreshold]}
                      min={0.25}
                      max={0.9}
                      step={0.05}
                      onValueChange={(val) => {
                        setConfidenceThreshold(val[0]);
                        handleUpdateConfig(val[0], undefined);
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <div>
                      <p className="font-medium text-foreground">Server Sync Enabled</p>
                      <p className="text-[11px] text-muted-foreground">Automatically upload verified issues</p>
                    </div>
                    <Switch
                      checked={serverSyncEnabled}
                      onCheckedChange={(checked) => {
                        setServerSyncEnabled(checked);
                        handleUpdateConfig(undefined, checked);
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Beautiful, Clean, Non-Disoriented Device Password Modal */}
        <Dialog open={isDiscoveryModalOpen} onOpenChange={setIsDiscoveryModalOpen}>
          <DialogContent className="sm:max-w-2xl bg-card border-border shadow-xl">
            <DialogHeader>
              <DialogTitle>Nearby Raspberry Pi 5 devices</DialogTitle>
              <DialogDescription className="text-xs">Select a Wi-Fi ID to register the device. A password is requested only the first time.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-2">
              {availableDevices.filter((device) => !registeredDevices.some((saved) => saved.id === device.id)).length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No unregistered SafeLive devices were discovered.</p>
              ) : availableDevices.filter((device) => !registeredDevices.some((saved) => saved.id === device.id)).map((dev) => (
                <button key={dev.id} type="button" className="flex items-center justify-between rounded-lg border border-border p-3 text-left hover:border-primary" onClick={() => { setSelectedDevice(dev); setDevicePassword(''); setIsDiscoveryModalOpen(false); setIsConnectModalOpen(true); }}>
                  <span><span className="block text-sm font-semibold">{dev.name}</span><span className="font-mono text-xs text-muted-foreground">{dev.ssid}</span></span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isConnectModalOpen} onOpenChange={setIsConnectModalOpen}>
          <DialogContent className="sm:max-w-md bg-card border-border shadow-xl">
            <DialogHeader>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Wifi className="h-5 w-5" />
                </div>
                <DialogTitle className="text-lg font-bold">Connect to {selectedDevice?.name || 'RPi 5 Device'}</DialogTitle>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Enter the device security password to pair your field portal with this Raspberry Pi 5 unit.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40 border border-border text-xs">
                <div>
                  <span className="text-muted-foreground">Wi-Fi SSID:</span>
                  <p className="font-mono font-bold text-foreground">{selectedDevice?.ssid}</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pass-input" className="text-xs font-semibold">
                  Device Security Password
                </Label>
                <div className="relative">
                  <Input
                    id="pass-input"
                    type={showPassword ? 'text' : 'password'}
                    value={devicePassword}
                    onChange={(e) => setDevicePassword(e.target.value)}
                    placeholder="Enter device password..."
                    className="pr-10 h-10 text-sm bg-background border-input"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">Default pairing key is <code>safelive2026</code></p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsConnectModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConnectDevice}
                disabled={isConnecting}
                className="bg-primary hover:bg-primary/90"
              >
                {isConnecting ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" /> : <Lock className="h-4 w-4 mr-1.5" />}
                Authenticate & Connect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Full-Screen Incident Snapshot Inspector Dialog */}
        <Dialog open={!!selectedIncident} onOpenChange={(open) => !open && setSelectedIncident(null)}>
          <DialogContent className="sm:max-w-xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {selectedIncident?.title}
              </DialogTitle>
              <DialogDescription className="text-xs font-mono">
                Event ID: {selectedIncident?.event_id}
              </DialogDescription>
            </DialogHeader>

            {selectedIncident && (
              <div className="space-y-4 py-2 text-xs">
                {selectedIncident.snapshot_url && (
                  <div className="rounded-xl overflow-hidden border border-border bg-black max-h-[320px] flex items-center justify-center">
                    <img
                      src={
                        selectedIncident.snapshot_url.startsWith('http')
                          ? selectedIncident.snapshot_url
                          : `${activeDevice?.url || ''}${selectedIncident.snapshot_url}`
                      }
                      alt={selectedIncident.title}
                      className="max-h-[320px] w-full object-contain"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-xl border border-border">
                  <div>
                    <span className="text-muted-foreground">Category:</span>
                    <p className="font-semibold text-foreground uppercase">{selectedIncident.category}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Department:</span>
                    <p className="font-semibold text-foreground">{selectedIncident.department}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Severity:</span>
                    <p className="font-semibold text-foreground uppercase">{selectedIncident.severity}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Confidence:</span>
                    <p className="font-semibold text-foreground">{(selectedIncident.confidence * 100).toFixed(1)}%</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">GPS Location:</span>
                    <p className="font-semibold font-mono text-foreground">
                      {selectedIncident.latitude != null && selectedIncident.longitude != null
                        ? `${selectedIncident.latitude.toFixed(6)}, ${selectedIncident.longitude.toFixed(6)}`
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Detected At:</span>
                    <p className="font-semibold text-foreground">
                      {new Date(selectedIncident.timestamp * 1000).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div>
                  <span className="text-muted-foreground font-medium">Incident Narrative:</span>
                  <p className="mt-1 text-foreground bg-card p-3 rounded-lg border border-border text-xs">
                    {selectedIncident.description}
                  </p>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setSelectedIncident(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </OfficialDashboardLayout>
  );
}
