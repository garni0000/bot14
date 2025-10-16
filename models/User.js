const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true,
    index: true // Pour accélérer les recherches
  },
  firstName: { type: String, default: '' },
  username: { type: String, default: '' },

  currentStage: {
    type: String,
    enum: [
      'initial',
      'sent_testimonials',
      'sent_question',
      'awaiting_response',
      'followup_1',
      'followup_2',
      'followup_3',
      'completed'
    ],
    default: 'initial'
  },

  hasResponded: { type: Boolean, default: false },

  responseType: {
    type: String,
    enum: ['positive', 'negative', 'none'],
    default: 'none'
  },

  lastMessageTime: { type: Date, default: Date.now },

  // Au lieu de 3 champs séparés → tableau flexible
  scheduledFollowups: [
    {
      stage: { type: String, enum: ['followup_1', 'followup_2', 'followup_3'] },
      date: { type: Date }
    }
  ],

  linkSent: { type: Boolean, default: false },
  linkSentAt: { type: Date, default: null },

  vipUnlocked: { type: Boolean, default: false },
  channelsJoined: { type: Boolean, default: false },

  // Pour tracking / fidélité
  referrerId: { type: Number, default: null },

  createdAt: { type: Date, default: Date.now },
  lastInteraction: { type: Date, default: Date.now }
});

// Middleware pour mise à jour auto de lastInteraction
userSchema.pre('save', function(next) {
  this.lastInteraction = new Date();
  next();
});

module.exports = mongoose.model('User', userSchema);
