import { UserType } from '@/types/auth';
import { Building2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoginTypeSelectorProps {
  selectedType: UserType;
  onSelectType: (type: UserType) => void;
}

export const LoginTypeSelector = ({ selectedType, onSelectType }: LoginTypeSelectorProps) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <button
        type="button"
        onClick={() => onSelectType('local')}
        className={cn(
          'relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-300',
          'hover:shadow-soft hover:-translate-y-0.5',
          selectedType === 'local'
            ? 'border-primary bg-primary/5 shadow-glow'
            : 'border-border bg-card hover:border-primary/50'
        )}
      >
        <div
          className={cn(
            'p-3 rounded-full transition-colors duration-300',
            selectedType === 'local' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          <User className="h-6 w-6" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground">Local User</h3>
          <p className="text-xs text-muted-foreground mt-1">Report incidents and track status</p>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onSelectType('official')}
        className={cn(
          'relative flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all duration-300',
          'hover:shadow-soft hover:-translate-y-0.5',
          selectedType === 'official'
            ? 'border-accent bg-accent/5 shadow-glow'
            : 'border-border bg-card hover:border-accent/50'
        )}
      >
        <div
          className={cn(
            'p-3 rounded-full transition-colors duration-300',
            selectedType === 'official' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
          )}
        >
          <Building2 className="h-6 w-6" />
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-foreground">Official User</h3>
          <p className="text-xs text-muted-foreground mt-1">Department and worker registration</p>
        </div>
      </button>
    </div>
  );
};
