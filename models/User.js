const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true
  },
  firstName: {
    type: String,
    default: ''
  },
  username: {
    type: String,
    default: ''
  },
  currentStage: {
    type: String,
    enum: ['initial', 'sent_testimonials', 'sent_question', 'awaiting_response', 'followup_1', 'followup_2', 'followup_3', 'completed'],
    default: 'initial'
  },
  hasResponded: {
    type: Boolean,
    default: false
  },
  responseType: {
    type: String,
    enum: ['positive', 'negative', 'none'],
    default: 'none'
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  scheduledFollowups: {
    followup1: { type: Date, default: null },
    followup2: { type: Date, default: null },
    followup3: { type: Date, default: null }
  },
  linkSent: {
    type: Boolean,
    default: false
  },
  linkSentAt: {
    type: Date,
    default: null
  },
  vipUnlocked: {
    type: Boolean,
    default: false
  },
  channelsJoined: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
