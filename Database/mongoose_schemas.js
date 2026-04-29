const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    userType: {
        type: String,
        required: true,
        enum: ['citizen', 'official', 'admin'],
        default: 'citizen'
    },
    department: {
        type: String,
        enum: ['Sanitation', 'Road', 'Electricity', 'Water', 'Police'],
        required: function() {
            return this.userType === 'official';
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ userType: 1 });

const incidentSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['garbage', 'pothole', 'streetlight', 'water', 'security']
    },
    location: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    imageUrl: {
        type: String
    },
    severity: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    status: {
        type: String,
        required: true,
        enum: ['open', 'in_progress', 'resolved'],
        default: 'open'
    },
    reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, {
    timestamps: true
});

incidentSchema.index({ status: 1 });
incidentSchema.index({ category: 1 });
incidentSchema.index({ severity: 1 });
incidentSchema.index({ createdAt: -1 });
incidentSchema.index({ reportedBy: 1 });

const ticketSchema = new mongoose.Schema({
    incidentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Incident',
        required: true
    },
    department: {
        type: String,
        required: true,
        enum: ['Sanitation', 'Road', 'Electricity', 'Water', 'Police']
    },
    assignedTo: {
        type: String,
        required: true
    },
    priority: {
        type: String,
        required: true,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },
    status: {
        type: String,
        required: true,
        enum: ['open', 'in_progress', 'resolved'],
        default: 'open'
    },
    notes: {
        type: String
    },
    resolvedAt: {
        type: Date
    }
}, {
    timestamps: true
});

ticketSchema.index({ status: 1 });
ticketSchema.index({ incidentId: 1 });
ticketSchema.index({ department: 1 });
ticketSchema.index({ priority: 1 });

const notificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        required: true,
        enum: ['incident_created', 'incident_updated', 'ticket_assigned', 'ticket_resolved', 'system']
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    incidentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Incident'
    },
    ticketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ticket'
    },
    read: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

notificationSchema.index({ userId: 1 });
notificationSchema.index({ read: 1 });
notificationSchema.index({ createdAt: -1 });

const User = mongoose.model('User', userSchema);
const Incident = mongoose.model('Incident', incidentSchema);
const Ticket = mongoose.model('Ticket', ticketSchema);
const Notification = mongoose.model('Notification', notificationSchema);

module.exports = {
    User,
    Incident,
    Ticket,
    Notification
};
