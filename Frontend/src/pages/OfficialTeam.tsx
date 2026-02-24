import { FormEvent, useEffect, useState } from 'react';
import { ShieldAlert, UserPlus } from 'lucide-react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';
import {
  ManagedOfficialAccount,
  ManagedOfficialRole,
  usersService,
} from '@/services/users';

const ROLE_OPTIONS: Array<{ value: ManagedOfficialRole; label: string }> = [
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'field_inspector', label: 'Field Inspector' },
];

const ROLE_LABELS: Record<ManagedOfficialRole, string> = {
  supervisor: 'Supervisor',
  field_inspector: 'Field Inspector',
};

const toOfficialRole = (value: string | undefined): string => {
  return (value || '').trim().toLowerCase().replace('-', '_');
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[6-9]\d{9}$/;
const pincodePattern = /^\d{6}$/;

const OfficialTeam = () => {
  const { toast } = useToast();
  const user = authService.getCurrentUser();
  const isDepartment = toOfficialRole(user?.officialRole) === 'department';

  const [managedOfficials, setManagedOfficials] = useState<ManagedOfficialAccount[]>([]);
  const [loadingOfficials, setLoadingOfficials] = useState(false);
  const [creating, setCreating] = useState(false);

  const [officialRole, setOfficialRole] = useState<ManagedOfficialRole>('supervisor');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [pincode, setPincode] = useState('');

  const loadManagedOfficials = async () => {
    if (!isDepartment) return;
    setLoadingOfficials(true);
    const response = await usersService.listManagedOfficials();
    if (response.success && response.data) {
      setManagedOfficials(response.data);
    } else {
      setManagedOfficials([]);
      toast({
        title: 'Could Not Load Team',
        description: response.error || 'Unable to load supervisor and field inspector accounts.',
        variant: 'destructive',
      });
    }
    setLoadingOfficials(false);
  };

  useEffect(() => {
    void loadManagedOfficials();
  }, [isDepartment]);

  const resetForm = () => {
    setOfficialRole('supervisor');
    setName('');
    setEmail('');
    setPhone('');
    setPassword('');
    setAddress('');
    setPincode('');
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanedName = name.trim();
    const cleanedEmail = email.trim().toLowerCase();
    const cleanedPhone = phone.trim();
    const cleanedAddress = address.trim();
    const cleanedPincode = pincode.trim();

    if (!cleanedName) {
      toast({ title: 'Name Required', description: 'Enter full name.', variant: 'destructive' });
      return;
    }
    if (!emailPattern.test(cleanedEmail)) {
      toast({ title: 'Invalid Email', description: 'Enter a valid email address.', variant: 'destructive' });
      return;
    }
    if (cleanedPhone && !phonePattern.test(cleanedPhone)) {
      toast({
        title: 'Invalid Phone',
        description: 'Enter a valid 10-digit mobile number.',
        variant: 'destructive',
      });
      return;
    }
    if (password.length < 8) {
      toast({
        title: 'Weak Password',
        description: 'Password must be at least 8 characters.',
        variant: 'destructive',
      });
      return;
    }
    if (cleanedPincode && !pincodePattern.test(cleanedPincode)) {
      toast({
        title: 'Invalid Pincode',
        description: 'Pincode must be 6 digits.',
        variant: 'destructive',
      });
      return;
    }

    setCreating(true);
    const response = await usersService.createManagedOfficial({
      name: cleanedName,
      email: cleanedEmail,
      phone: cleanedPhone || undefined,
      password,
      officialRole,
      address: cleanedAddress || undefined,
      pincode: cleanedPincode || undefined,
    });
    if (response.success) {
      toast({
        title: 'Account Created',
        description: `${ROLE_LABELS[officialRole]} account has been created successfully.`,
      });
      resetForm();
      await loadManagedOfficials();
    } else {
      toast({
        title: 'Creation Failed',
        description: response.error || 'Unable to create official account.',
        variant: 'destructive',
      });
    }
    setCreating(false);
  };

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="space-y-2">
          <h1 className="text-2xl font-heading font-bold text-foreground">Department Team Management</h1>
          <p className="text-muted-foreground">
            Create and manage supervisor and field inspector accounts.
          </p>
        </div>

        {!isDepartment ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4" />
              <span>Only department accounts can access this section.</span>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Create Official Account</h2>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-2">
                  <Label>Official Role</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ROLE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setOfficialRole(option.value)}
                        className={`h-10 rounded-md border text-sm font-medium transition-colors ${
                          officialRole === option.value
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-background hover:bg-muted'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="managed-name">Full Name</Label>
                    <Input
                      id="managed-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Enter full name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-email">Email</Label>
                    <Input
                      id="managed-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="official@safelive.in"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-phone">Phone (Optional)</Label>
                    <Input
                      id="managed-phone"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="9876543210"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-password">Temporary Password</Label>
                    <Input
                      id="managed-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managed-pincode">Pincode (Optional)</Label>
                    <Input
                      id="managed-pincode"
                      value={pincode}
                      onChange={(event) => setPincode(event.target.value)}
                      placeholder="751024"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="managed-address">Address (Optional)</Label>
                  <Textarea
                    id="managed-address"
                    rows={3}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="Office or area address"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={creating}>
                    <UserPlus className="mr-1 h-4 w-4" />
                    {creating ? 'Creating...' : 'Create Account'}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm} disabled={creating}>
                    Reset
                  </Button>
                </div>
              </form>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Added Supervisors / Field Inspectors</h2>
              {loadingOfficials && <div className="text-sm text-muted-foreground">Loading list...</div>}
              {!loadingOfficials && managedOfficials.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No supervisor or field inspector accounts created yet.
                </div>
              )}
              {!loadingOfficials && managedOfficials.length > 0 && (
                <ul className="overflow-hidden rounded-md border border-border">
                  {managedOfficials.map((account, index) => {
                    const roleValue = account.officialRole || 'supervisor';
                    return (
                      <li key={account.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
                        <div className="min-w-0 truncate text-foreground">
                          {index + 1}. {account.name || account.email || account.phone || 'Official'}
                        </div>
                        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {ROLE_LABELS[roleValue as ManagedOfficialRole] || roleValue}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </OfficialDashboardLayout>
  );
};

export default OfficialTeam;
