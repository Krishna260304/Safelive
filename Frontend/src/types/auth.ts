export type UserType = 'local' | 'official' | 'head_supervisor';
export type LoginMethod = 'email' | 'phone';
export type OfficialRole = 'department' | 'supervisor' | 'field_inspector' | 'worker';

export interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  userType: UserType;
  officialRole?: OfficialRole;
  workerSpecialization?: string;
  address?: string;
  pincode?: string;
  createdAt: Date;
  isVerified: boolean;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  status: IncidentStatus;
  priority: IncidentPriority;
  location: {
    address: string;
    latitude?: number;
    longitude?: number;
  };
  images: string[];
  reportedBy: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
}

export type IncidentCategory = 
  | 'pothole'
  | 'waterlogging'
  | 'garbage'
  | 'streetlight'
  | 'water_leakage'
  | 'electricity'
  | 'fire'
  | 'safety'
  | 'road_damage'
  | 'drainage'
  | 'other';

export type IncidentStatus = 
  | 'open'
  | 'pending'
  | 'in_progress'
  | 'resolved'
  | 'verified'
  | 'rejected';

export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Message {
  id: string;
  incidentId: string;
  senderId: string;
  senderName: string;
  senderType: UserType;
  content: string;
  timestamp: Date;
  isRead: boolean;
}



// export type UserType = 'local' | 'official';
// export type LoginMethod = 'email' | 'phone';

// export interface User {
//   id: string;
//   email: string;
//   phone: string;
//   fullName: string;
//   userType: UserType;
//   address?: string;
//   pincode?: string;
//   createdAt: Date;
//   isVerified: boolean;
// }

// export interface AuthState {
//   user: User | null;
//   isAuthenticated: boolean;
//   isLoading: boolean;
// }

// export interface Incident {
//   id: string;
//   title: string;
//   description: string;
//   category: IncidentCategory;
//   status: IncidentStatus;
//   priority: IncidentPriority;
//   location: {
//     address: string;
//     latitude?: number;
//     longitude?: number;
//   };
//   images: string[];
//   reportedBy: string;
//   assignedTo?: string;
//   createdAt: Date;
//   updatedAt: Date;
//   resolvedAt?: Date;
// }

// export type IncidentCategory = 
//   | 'pothole'
//   | 'waterlogging'
//   | 'garbage'
//   | 'streetlight'
//   | 'water_leakage'
//   | 'electricity'
//   | 'safety'
//   | 'road_damage'
//   | 'drainage'
//   | 'other';

// export type IncidentStatus = 
//   | 'open'
//   | 'in_progress'
//   | 'resolved'
//   | 'verified'
//   | 'rejected';

// export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical';

// export interface Message {
//   id: string;
//   incidentId: string;
//   senderId: string;
//   senderName: string;
//   senderType: UserType;
//   content: string;
//   timestamp: Date;
//   isRead: boolean;
// }
