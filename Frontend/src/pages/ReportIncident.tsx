import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  Camera, 
  MapPin, 
  X, 
  Send,
  AlertTriangle
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { incidentService } from '@/services/incidents';
import { LocationPickerMap, PickedLocation } from '@/components/maps/LocationPickerMap';

const incidentSchema = z.object({
  title: z.string().trim().min(10, 'Title must be at least 10 characters').max(100, 'Title too long'),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(1000, 'Description too long'),
  category: z.string().min(1, 'Please select a category'),
  address: z.string().trim().min(10, 'Please enter complete address').max(200, 'Address too long'),
  pincode: z.string().regex(/^\d{6}$/, 'Enter valid 6-digit pincode'),
});

type IncidentFormData = z.infer<typeof incidentSchema>;

const categories = [
  { value: 'pothole', label: 'Pothole / Road Damage' },
  { value: 'waterlogging', label: 'Waterlogging' },
  { value: 'garbage', label: 'Garbage / Sanitation' },
  { value: 'streetlight', label: 'Streetlight Issue' },
  { value: 'water_leakage', label: 'Water Leakage' },
  { value: 'electricity', label: 'Electricity Issue' },
  { value: 'fire', label: 'Fire Incident' },
  { value: 'drainage', label: 'Drainage / Sewer' },
  { value: 'safety', label: 'Safety / Security' },
  { value: 'other', label: 'Other' },
];

type GpsCoords = {
  lat: number;
  lon: number;
  accuracy?: number;
  source: 'live_gps' | 'map_pick';
};

const getGpsErrorMessage = (error: GeolocationPositionError | null) => {
  if (!error) return 'Unable to fetch device GPS location.';
  if (error.code === error.PERMISSION_DENIED) return 'Location permission denied. Enable GPS/location access and try again.';
  if (error.code === error.POSITION_UNAVAILABLE) return 'Device GPS location is unavailable.';
  if (error.code === error.TIMEOUT) return 'Timed out while fetching GPS location.';
  return 'Unable to fetch device GPS location.';
};

const ReportIncident = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [coords, setCoords] = useState<GpsCoords | null>(null);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState<GpsCoords | null>(null);
  const [locationError, setLocationError] = useState('');

  const form = useForm<IncidentFormData>({
    resolver: zodResolver(incidentSchema),
    mode: 'onBlur',
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages = Array.from(files).slice(0, 5 - images.length).map(file => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setImages(prev => [...prev, ...newImages]);
  };

  const fetchGpsLocation = useCallback(
    async (showErrorToast = false): Promise<GpsCoords | null> => {
      if (!navigator.geolocation) {
        const message = 'Geolocation is not supported on this device/browser.';
        setLocationError(message);
        if (showErrorToast) {
          toast({
            title: 'GPS Required',
            description: message,
            variant: 'destructive',
          });
        }
        return null;
      }

      setIsLocating(true);
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          });
        });
        const gpsCoords: GpsCoords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          source: 'live_gps',
        };
        setLocationError('');
        return gpsCoords;
      } catch (error) {
        const geoError =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as GeolocationPositionError)
            : null;
        const message = getGpsErrorMessage(geoError);
        setLocationError(message);
        if (showErrorToast) {
          toast({
            title: 'GPS Required',
            description: message,
            variant: 'destructive',
          });
        }
        return null;
      } finally {
        setIsLocating(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    const loadInitialGps = async () => {
      const gps = await fetchGpsLocation(false);
      if (gps) {
        setCoords(gps);
      }
    };
    void loadInitialGps();
  }, [fetchGpsLocation]);

  const removeImage = (index: number) => {
    setImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  const handleSubmit = async (data: IncidentFormData) => {
    if (images.length === 0) {
      toast({
        title: "Photos Required",
        description: "Please upload at least one photo of the incident.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (!coords) {
        setLocationDialogOpen(true);
        toast({
          title: "Location Required",
          description: "Select location using live GPS or map picker before submitting.",
          variant: "destructive",
        });
        return;
      }

      const incidentData = {
        title: data.title,
        description: data.description,
        category: data.category,
        location: `${data.address}, Pincode: ${data.pincode}`,
        latitude: coords.lat,
        longitude: coords.lon,
        images: images.map(img => img.file),
      };

      const response = await incidentService.createIncident(incidentData);

      if (response.success) {
        const incidentId = response.data?.incidentId || response.data?.id;
        const incidentIdText = incidentId ? `Incident ID: ${incidentId}. ` : '';
        toast({
          title: "Report Submitted!",
          description: `${incidentIdText}Your incident report has been submitted successfully. You'll receive updates on its progress.`,
        });
        navigate('/dashboard');
      } else {
        toast({
          title: "Submission Failed",
          description: response.error || "Failed to submit report. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      const fallback = "Unable to connect to server. Please try again.";
      const message = error instanceof Error && error.message ? error.message : fallback;
      toast({
        title: "Submission Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openLocationDialog = () => {
    setLocationDraft(coords);
    setLocationDialogOpen(true);
  };

  const updateDraftFromMap = (picked: PickedLocation) => {
    setLocationDraft({
      lat: picked.lat,
      lon: picked.lon,
      source: 'map_pick',
    });
    setLocationError('');
  };

  const applyLiveGpsInDialog = async () => {
    const gps = await fetchGpsLocation(true);
    if (gps) {
      setLocationDraft(gps);
    }
  };

  const saveLocationFromDialog = () => {
    if (!locationDraft) {
      toast({
        title: "Location Required",
        description: "Pick a point on map or use live GPS.",
        variant: "destructive",
      });
      return;
    }
    setCoords(locationDraft);
    setLocationDialogOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="mb-8">
          <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
            Report an Incident
          </h1>
          <p className="text-muted-foreground">
            Provide details about the civic issue you've encountered.
          </p>
        </div>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          {/* Image Upload */}
          <div className="space-y-3">
            <Label>Photos of Incident *</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {images.map((img, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-border">
                  <img 
                    src={img.preview} 
                    alt={`Upload ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              
              {images.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-xs">Add Photo</span>
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleImageUpload}
            />
            <p className="text-xs text-muted-foreground">
              Upload up to 5 photos. Clear images help in faster resolution.
            </p>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Issue Title *</Label>
            <Input
              id="title"
              placeholder="e.g., Large pothole causing traffic issues"
              {...form.register('title')}
              className={cn(
                form.formState.errors.title && "border-destructive focus-visible:ring-destructive"
              )}
            />
            {form.formState.errors.title && (
              <p className="text-sm text-destructive">
                {form.formState.errors.title.message}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe the issue in detail. Include any relevant information that might help in resolution..."
              rows={4}
              {...form.register('description')}
              className={cn(
                "resize-none",
                form.formState.errors.description && "border-destructive focus-visible:ring-destructive"
              )}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
          </div>

          {/* Category */}
          <div className="space-y-2">
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select onValueChange={(val) => form.setValue('category', val)}>
                <SelectTrigger className={cn(
                  form.formState.errors.category && "border-destructive"
                )}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.category && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.category.message}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Priority is assigned automatically by the AI model after submission.
            </p>
          </div>

          {/* Location */}
          <div className="space-y-4 p-4 bg-muted/50 rounded-xl">
          <div className="flex items-center gap-2 text-foreground">
            <MapPin className="h-5 w-5 text-primary" />
            <span className="font-medium">Location Details</span>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {coords
                  ? `Selected (${coords.source === 'live_gps' ? 'Live GPS' : 'Map Picker'}): ${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}${
                      typeof coords.accuracy === 'number' ? ` (accuracy +/-${Math.round(coords.accuracy)}m)` : ''
                    }`
                  : 'No location selected yet. Use live GPS or map picker.'}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const gps = await fetchGpsLocation(true);
                    if (gps) {
                      setCoords(gps);
                    }
                  }}
                  disabled={isSubmitting || isLocating}
                >
                  {isLocating ? 'Locating...' : 'Use Live GPS'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={openLocationDialog} disabled={isSubmitting}>
                  Select on Map
                </Button>
              </div>
            </div>
          </div>
          {locationError && (
            <p className="text-xs text-destructive">{locationError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            You can submit using either live GPS location or a map-selected point.
          </p>

            <div className="space-y-2">
              <Label htmlFor="address">Complete Address *</Label>
              <Textarea
                id="address"
                placeholder="Enter the complete address where the incident is located"
                rows={2}
                {...form.register('address')}
                className={cn(
                  "resize-none",
                  form.formState.errors.address && "border-destructive focus-visible:ring-destructive"
                )}
              />
              {form.formState.errors.address && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.address.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="pincode">Pincode *</Label>
              <Input
                id="pincode"
                placeholder="123456"
                maxLength={6}
                {...form.register('pincode')}
                className={cn(
                  "w-32",
                  form.formState.errors.pincode && "border-destructive focus-visible:ring-destructive"
                )}
              />
              {form.formState.errors.pincode && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.pincode.message}
                </p>
              )}
            </div>
          </div>

          {/* Notice */}
          <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-xl border border-warning/20">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-foreground mb-1">Important Notice</p>
              <p className="text-muted-foreground">
                False or misleading reports may result in account suspension. Please ensure all information provided is accurate.
              </p>
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => navigate('/dashboard')}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 gradient-primary hover:opacity-90"
              disabled={isSubmitting || isLocating}
            >
              {isSubmitting ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Submitting...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  Submit Report
                </div>
              )}
            </Button>
          </div>
        </form>
      </div>

      <Dialog
        open={locationDialogOpen}
        onOpenChange={(open) => {
          setLocationDialogOpen(open);
          if (!open) {
            setLocationDraft(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Incident Location</DialogTitle>
            <DialogDescription>
              Choose one option: use live GPS or tap/click on map to pin exact location.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">
                {locationDraft
                  ? `Draft: ${locationDraft.lat.toFixed(6)}, ${locationDraft.lon.toFixed(6)} (${locationDraft.source === 'live_gps' ? 'Live GPS' : 'Map Picker'})`
                  : 'No draft location selected.'}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void applyLiveGpsInDialog()} disabled={isLocating}>
                {isLocating ? 'Locating...' : 'Use Live GPS'}
              </Button>
            </div>

            <LocationPickerMap
              value={locationDraft ? { lat: locationDraft.lat, lon: locationDraft.lon } : null}
              onChange={updateDraftFromMap}
              height="360px"
            />

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setLocationDialogOpen(false);
                  setLocationDraft(null);
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={saveLocationFromDialog}>
                Use Selected Location
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default ReportIncident;
