import { useEffect, useMemo, useState } from 'react';
import { Bell, Lock, User } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';
import { usersService } from '@/services/users';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOfficial?: boolean;
}

type TabId = 'general' | 'notifications' | 'privacy';

export const SettingsModal = ({ open, onOpenChange, isOfficial = false }: SettingsModalProps) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [notifications, setNotifications] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);

  const [profile, setProfile] = useState({
    name: '',
    email: '',
    phone: '',
    department: '',
    address: '',
    pincode: '',
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);

  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorTarget, setTwoFactorTarget] = useState<boolean | null>(null);
  const [twoFactorChallengeId, setTwoFactorChallengeId] = useState<string | null>(null);
  const [twoFactorOtp, setTwoFactorOtp] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  const twoFactorSwitchValue = useMemo(
    () => (twoFactorTarget !== null ? twoFactorTarget : twoFactorEnabled),
    [twoFactorEnabled, twoFactorTarget]
  );

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChallengeId, setPasswordChallengeId] = useState<string | null>(null);
  const [passwordOtp, setPasswordOtp] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordConfirmBusy, setPasswordConfirmBusy] = useState(false);

  const handleClose = () => {
    onOpenChange(false);
  };

  const _clean = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  const describeChannels = (channels?: string[]) => {
    const set = new Set(channels || []);
    const hasEmail = set.has('email');
    const hasSms = set.has('sms');
    if (hasEmail && hasSms) return 'your email and phone';
    if (hasSms) return 'your phone';
    if (hasEmail) return 'your email';
    return 'your account';
  };

  useEffect(() => {
    if (!open) return;

    const localUser = authService.getCurrentUser();
    setProfile({
      name: localUser?.name || '',
      email: localUser?.email || '',
      phone: localUser?.phone || '',
      department: localUser?.department || '',
      address: localUser?.address || '',
      pincode: localUser?.pincode || '',
    });
    setTwoFactorEnabled(!!localUser?.twoFactorEnabled);

    setTwoFactorTarget(null);
    setTwoFactorChallengeId(null);
    setTwoFactorOtp('');
    setPasswordChallengeId(null);
    setPasswordOtp('');

    (async () => {
      setProfileLoading(true);
      try {
        const response = await usersService.getProfile();
        if (response.success && response.data) {
          setProfile({
            name: response.data.name || '',
            email: response.data.email || '',
            phone: response.data.phone || '',
            department: response.data.department || '',
            address: response.data.address || '',
            pincode: response.data.pincode || '',
          });
          setTwoFactorEnabled(!!response.data.twoFactorEnabled);
          localStorage.setItem('user', JSON.stringify(response.data));
        }
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [open]);

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const response = await usersService.updateProfile({
        name: _clean(profile.name),
        email: _clean(profile.email),
        phone: _clean(profile.phone),
        address: _clean(profile.address),
        pincode: _clean(profile.pincode),
        ...(isOfficial ? { department: _clean(profile.department) } : {}),
      });

      if (response.success && response.data) {
        localStorage.setItem('user', JSON.stringify(response.data));
        toast({
          title: 'Saved',
          description: 'Your profile details were updated.',
        });
        onOpenChange(false);
        return;
      }

      toast({
        title: 'Save Failed',
        description: response.error || 'Unable to update profile.',
        variant: 'destructive',
      });
    } finally {
      setProfileSaving(false);
    }
  };

  const requestPasswordOtp = async () => {
    if (!currentPassword.trim()) {
      toast({
        title: 'Current Password Required',
        description: 'Enter your current password.',
        variant: 'destructive',
      });
      return;
    }
    if (!newPassword.trim()) {
      toast({
        title: 'New Password Required',
        description: 'Enter a new password.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Mismatch',
        description: 'New password and confirm password do not match.',
        variant: 'destructive',
      });
      return;
    }

    setPasswordBusy(true);
    try {
      const response = await authService.requestPasswordChangeOtp(currentPassword);
      if (response.success && response.data?.challengeId) {
        setPasswordChallengeId(response.data.challengeId);
        setPasswordOtp('');
        toast({
          title: 'OTP Sent',
          description: `A code was sent to ${describeChannels(response.data.channels)}.`,
        });
        return;
      }
      toast({
        title: 'OTP Failed',
        description: response.error || 'Unable to send OTP.',
        variant: 'destructive',
      });
    } finally {
      setPasswordBusy(false);
    }
  };

  const confirmPasswordChange = async () => {
    if (!passwordChallengeId) return;
    if (!passwordOtp.trim()) {
      toast({ title: 'OTP Required', description: 'Enter the OTP code.', variant: 'destructive' });
      return;
    }
    setPasswordConfirmBusy(true);
    try {
      const response = await authService.confirmPasswordChange(passwordChallengeId, passwordOtp.trim(), newPassword);
      if (response.success) {
        toast({ title: 'Password Updated', description: 'Your password has been changed.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordChallengeId(null);
        setPasswordOtp('');
        return;
      }
      toast({
        title: 'Change Failed',
        description: response.error || 'Unable to change password.',
        variant: 'destructive',
      });
    } finally {
      setPasswordConfirmBusy(false);
    }
  };

  const requestTwoFactorOtp = async (targetEnabled: boolean) => {
    setTwoFactorBusy(true);
    try {
      const response = targetEnabled ? await authService.requestEnable2faOtp() : await authService.requestDisable2faOtp();
      if (response.success && response.data?.challengeId) {
        setTwoFactorTarget(targetEnabled);
        setTwoFactorChallengeId(response.data.challengeId);
        setTwoFactorOtp('');
        toast({
          title: 'OTP Sent',
          description: `A code was sent to ${describeChannels(response.data.channels)}.`,
        });
        return;
      }
      toast({
        title: 'OTP Failed',
        description: response.error || 'Unable to send OTP.',
        variant: 'destructive',
      });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const confirmTwoFactor = async () => {
    if (!twoFactorChallengeId || twoFactorTarget === null) return;
    if (!twoFactorOtp.trim()) {
      toast({ title: 'OTP Required', description: 'Enter the OTP code.', variant: 'destructive' });
      return;
    }

    setTwoFactorBusy(true);
    try {
      const response = twoFactorTarget
        ? await authService.confirmEnable2fa(twoFactorChallengeId, twoFactorOtp.trim())
        : await authService.confirmDisable2fa(twoFactorChallengeId, twoFactorOtp.trim());

      if (response.success && response.data) {
        setTwoFactorEnabled(!!response.data.twoFactorEnabled);
        setTwoFactorTarget(null);
        setTwoFactorChallengeId(null);
        setTwoFactorOtp('');
        toast({
          title: 'Updated',
          description: `Two-factor authentication ${response.data.twoFactorEnabled ? 'enabled' : 'disabled'}.`,
        });
        return;
      }

      toast({
        title: 'Update Failed',
        description: response.error || 'Unable to update 2FA.',
        variant: 'destructive',
      });
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const tabs = [
    { id: 'general' as const, label: 'General', icon: User },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'privacy' as const, label: 'Privacy & Security', icon: Lock },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Settings</DialogTitle>
          <DialogDescription>Manage your account settings and preferences</DialogDescription>
        </DialogHeader>

        <div className="flex gap-6 mt-6">
          <div className="w-40 space-y-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left",
                    activeTab === tab.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 space-y-6">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-foreground mb-4">Account Information</h3>
                  {profileLoading && <div className="text-sm text-muted-foreground mb-4">Loading profile...</div>}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">Full Name</Label>
                      <input
                        type="text"
                        placeholder="Enter your name"
                        value={profile.name}
                        onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Email Address</Label>
                      <input
                        type="email"
                        placeholder="abc@gmail.com"
                        value={profile.email}
                        onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Phone Number</Label>
                      <input
                        type="tel"
                        placeholder="9876543210"
                        value={profile.phone}
                        onChange={(e) => setProfile((prev) => ({ ...prev, phone: e.target.value }))}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Address</Label>
                      <input
                        type="text"
                        placeholder="Address"
                        value={profile.address}
                        onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Pincode</Label>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="123456"
                        value={profile.pincode}
                        onChange={(e) => setProfile((prev) => ({ ...prev, pincode: e.target.value }))}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    {isOfficial && (
                      <div>
                        <Label className="text-sm text-muted-foreground">Department</Label>
                        <input
                          type="text"
                          placeholder="Municipal Office"
                          value={profile.department}
                          onChange={(e) => setProfile((prev) => ({ ...prev, department: e.target.value }))}
                          className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-foreground mb-4">Notification Preferences</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                      <div>
                        <p className="font-medium text-foreground">Push Notifications</p>
                        <p className="text-sm text-muted-foreground">Get notified about updates</p>
                      </div>
                      <Switch checked={notifications} onCheckedChange={setNotifications} />
                    </div>
                    <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                      <div>
                        <p className="font-medium text-foreground">Email Alerts</p>
                        <p className="text-sm text-muted-foreground">Receive emails for important updates</p>
                      </div>
                      <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold text-foreground mb-4">Change Password (OTP)</h3>
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">Current Password</Label>
                      <input
                        type="password"
                        placeholder="********"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">New Password</Label>
                      <input
                        type="password"
                        placeholder="********"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Confirm Password</Label>
                      <input
                        type="password"
                        placeholder="********"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground mt-1"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <Button type="button" onClick={requestPasswordOtp} disabled={passwordBusy || passwordConfirmBusy}>
                        {passwordBusy ? 'Sending OTP...' : 'Send OTP'}
                      </Button>
                      {passwordChallengeId && (
                        <span className="text-xs text-muted-foreground">OTP sent. Enter code to confirm.</span>
                      )}
                    </div>

                    {passwordChallengeId && (
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">OTP Code</Label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="Enter OTP"
                          value={passwordOtp}
                          onChange={(e) => setPasswordOtp(e.target.value)}
                          className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground"
                        />
                        <Button
                          type="button"
                          onClick={confirmPasswordChange}
                          disabled={passwordConfirmBusy || passwordBusy}
                          className="w-full"
                        >
                          {passwordConfirmBusy ? 'Updating...' : 'Confirm Password Change'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-foreground mb-4">Two-Factor Authentication (OTP)</h3>
                  <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div>
                      <p className="font-medium text-foreground">Enable 2FA</p>
                      <p className="text-sm text-muted-foreground">Require OTP after password on login</p>
                    </div>
                    <Switch
                      checked={twoFactorSwitchValue}
                      disabled={twoFactorBusy || !!twoFactorChallengeId}
                      onCheckedChange={(next) => requestTwoFactorOtp(next)}
                    />
                  </div>

                  {twoFactorChallengeId && (
                    <div className="mt-4 p-4 border border-border rounded-lg space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Enter OTP to {twoFactorTarget ? 'enable' : 'disable'} 2FA.
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">OTP Code</Label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="Enter OTP"
                          value={twoFactorOtp}
                          onChange={(e) => setTwoFactorOtp(e.target.value)}
                          className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground"
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button type="button" onClick={confirmTwoFactor} disabled={twoFactorBusy}>
                          {twoFactorBusy ? 'Confirming...' : 'Confirm'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setTwoFactorTarget(null);
                            setTwoFactorChallengeId(null);
                            setTwoFactorOtp('');
                          }}
                          disabled={twoFactorBusy}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-border">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (activeTab === 'general') {
                handleSaveProfile();
                return;
              }
              handleClose();
            }}
            disabled={profileSaving || profileLoading}
          >
            {activeTab === 'general' ? (profileSaving ? 'Saving...' : 'Save Changes') : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
