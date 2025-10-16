// bot.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const schedule = require('node-schedule'); // si tu veux jobs cron plus tard (non obligatoire ici)
const User = require('./models/User');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || null; // ex: https://bot14-5qrr.onrender.com

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN manquant dans .env');
  process.exit(1);
}
if (!MONGO_URL) {
  console.error('❌ MONGO_URL / MONGODB_URI manquant dans .env');
  process.exit(1);
}

/* -------------------- Connexion MongoDB -------------------- */
mongoose.connect(MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch(err => {
    console.error('❌ Erreur MongoDB:', err);
    process.exit(1);
  });

/* -------------------- Réponses utilitaires -------------------- */
const positiveResponses = ['oui', 'yes', 'bien sûr', 'bien sur', 'ok', "d'accord", 'daccord', 'chaud', 'partant', 'go', 'ouais', 'yep', 'yeah'];
const negativeResponses = ['non', 'no', 'jamais', 'pas intéressé', 'pas interesse', 'arrête', 'arrete', 'stop'];

function isPositiveResponse(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase().trim();
  return positiveResponses.some(r => lowerText.includes(r));
}
function isNegativeResponse(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase().trim();
  return negativeResponses.some(r => lowerText.includes(r));
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/* -------------------- Notification admin -------------------- */
async function sendAdminNotification(message) {
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (!adminId) return;
  try {
    await bot.sendMessage(adminId.toString(), `🔔 ${message}`);
  } catch (err) {
    console.error('❌ Erreur notification admin:', err);
  }
}

/* -------------------- Init Bot (polling/webhook fallback) -------------------- */
let bot;
let usingWebhook = false;

function attachHandlers() {
  // /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from?.first_name || 'ami';
    const username = msg.from?.username || '';

    try {
      // Upsert pour éviter duplicate key (E11000)
      let user = await User.findOneAndUpdate(
        { chatId },
        {
          $set: {
            firstName,
            username,
            currentStage: 'initial',
            hasResponded: false,
            responseType: 'none',
            lastMessageTime: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { new: true, upsert: true }
      );

      // Envoi de la vidéo de démarrage si configurée
      if (process.env.VIDEO_START) {
        try {
          await bot.sendVideo(chatId, process.env.VIDEO_START, {
            reply_markup: {
              inline_keyboard: [[{ text: '🔥 Rejoindre le canal', url: process.env.CHANNEL_VIP || 'https://t.me/+tPrtqmEX7otiMmM0' }]]
            }
          });
          console.log(`📹 Vidéo start envoyée à ${firstName} (${chatId})`);
        } catch (err) {
          console.warn('⚠️ Erreur envoi VIDEO_START:', err.message || err);
        }
      } else {
        await bot.sendMessage(chatId, `Bienvenue ${firstName} 👋`);
      }

      // Envoie témoignages (VIDEO_TEMOIGNAGE_1..5)
      for (let i = 1; i <= 5; i++) {
        const envVar = process.env[`VIDEO_TEMOIGNAGE_${i}`];
        if (!envVar) continue;
        try {
          await sleep(15000 * (i === 1 ? 1 : 0)); // gros wait avant premier témoignage (si tu veux)
          await bot.sendVideo(chatId, envVar);
          console.log(`📹 Vidéo témoignage ${i} envoyée à ${firstName}`);
          await sleep(1000);
        } catch (err) {
          console.warn(`⚠️ Erreur envoi VIDEO_TEMOIGNAGE_${i}:`, err.message || err);
        }
      }

      // Mise à jour état
      await User.findOneAndUpdate({ chatId }, { $set: { currentStage: 'sent_testimonials', lastMessageTime: new Date() } });

      // Après un délai, poser la question
      setTimeout(async () => {
        try {
          await bot.sendMessage(chatId, "Du coup, voulez-vous gagner avec nous ?? 💰", {
            reply_markup: {
              keyboard: [[{ text: '🔓 Débloquer mon accès au VIP' }]],
              resize_keyboard: true
            }
          });
          await User.findOneAndUpdate({ chatId }, { $set: { currentStage: 'sent_question', lastMessageTime: new Date() } });
          console.log(`💬 Message question envoyé à ${firstName} (${chatId})`);
          scheduleFollowup1(chatId, firstName);
        } catch (err) {
          console.error('❌ Erreur envoi question:', err);
        }
      }, 30000); // 30s après témoignages (comme dans ton ancien code)

    } catch (error) {
      console.error('❌ Erreur dans /start:', error);
    }
  });

  // Message handler
  bot.on('message', async (msg) => {
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;
    const text = msg.text || '';
    if (text && text.startsWith('/')) return; // ignore commandes ici

    try {
      const user = await User.findOneAndUpdate(
        { chatId },
        { $set: { lastMessageTime: new Date(), firstName: msg.from?.first_name || '', username: msg.from?.username || '' } },
        { new: true, upsert: true }
      );

      // Buttons flows
      if (text === '🔓 Débloquer mon accès au VIP') {
        await bot.sendMessage(chatId, "Veuillez rejoindre les canaux pour avoir ton accès 🔐", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'VIP', url: process.env.CHANNEL_VIP || 'https://t.me/+tPrtqmEX7otiMmM0' },
                { text: 'Canal 1', url: process.env.CHANNEL_1 || 'https://t.me/channel1' }
              ],
              [
                { text: 'Canal 2', url: process.env.CHANNEL_2 || 'https://t.me/channel2' },
                { text: 'Canal 3', url: process.env.CHANNEL_3 || 'https://t.me/channel3' }
              ],
              [
                { text: 'Canal 4', url: process.env.CHANNEL_4 || 'https://t.me/channel4' }
              ],
              [
                { text: '✅ Check', callback_data: 'check_channels' }
              ]
            ]
          }
        });
        console.log(`🔓 Demande déblocage VIP: ${user.firstName} (${chatId})`);
        return;
      }

      if (text === '🎯 Accéder au hack') {
        if (!user.channelsJoined) {
          await bot.sendMessage(chatId, "❌ Vous devez d'abord rejoindre tous les canaux et cliquer sur Check !");
          return;
        }
        await bot.sendMessage(chatId, "Voici vos bots 🤖", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🍎 Apple F', url: process.env.BOT_APPLE_F || 'https://t.me/applefbot' },
                { text: '🎮 Kami', url: process.env.BOT_KAMI || 'https://t.me/kamibot' }
              ],
              [
                { text: '💥 Crash', url: process.env.BOT_CRASH || 'https://t.me/crashbot' }
              ],
              [
                { text: '💬 Support', url: `https://t.me/${process.env.ADMIN_USERNAME || 'juzzpp'}` }
              ]
            ]
          }
        });
        console.log(`🎯 Accès hack fourni à ${user.firstName} (${chatId})`);
        return;
      }

      // If user in followup_3 stage, handle final responses specially
      if (user.currentStage === 'followup_3') {
        if (isPositiveResponse(text) && !user.hasResponded) {
          await User.findOneAndUpdate({ chatId }, {
            $set: {
              hasResponded: true,
              responseType: 'positive',
              currentStage: 'completed',
              linkSent: true,
              linkSentAt: new Date()
            }
          });
          try {
            await bot.sendMessage(chatId, `Voici le lien d'inscription : ${process.env.LINK_REGISTER || 'https://example.com'} 🚀`);
            console.log(`🔗 Lien envoyé à ${user.firstName} (${chatId})`);
            await sendAdminNotification(`💰 CONVERSION! ${user.firstName} (@${user.username || 'pas de username'}) a reçu le lien d'inscription (étape: followup_3)`);
          } catch (err) {
            console.error('❌ Erreur envoi lien:', err);
          }
        } else if (isNegativeResponse(text) && !user.hasResponded) {
          await User.findOneAndUpdate({ chatId }, { $set: { hasResponded: true, responseType: 'negative', currentStage: 'completed' } });
          console.log(`❌ Réponse négative finale de ${user.firstName} (${chatId})`);
        }
        return;
      }

      // General replies for sent_question / awaiting_response / followups 1/2
      if (['sent_question', 'awaiting_response', 'followup_1', 'followup_2'].includes(user.currentStage)) {
        if (isPositiveResponse(text)) {
          await User.findOneAndUpdate({ chatId }, { $set: { hasResponded: true, responseType: 'positive', currentStage: 'completed' } });
          await bot.sendMessage(chatId, "Super ! 🎉 Veuillez m'envoyer un message privé et je te guide étape par étape ! 📩 @juzzpp");
          console.log(`✅ Réponse positive de ${user.firstName} (${chatId})`);
          await sendAdminNotification(`✅ Réponse OUI de ${user.firstName} (@${user.username || 'pas de username'}) - Étape: ${user.currentStage}`);
        } else if (isNegativeResponse(text)) {
          await User.findOneAndUpdate({ chatId }, { $set: { hasResponded: true, responseType: 'negative', currentStage: 'completed' } });
          console.log(`❌ Réponse négative de ${user.firstName} (${chatId})`);
        }
      } else {
        // Optionnel : réponse générique / log
        // await bot.sendMessage(chatId, "Message reçu — merci !");
      }

    } catch (error) {
      console.error('❌ Erreur traitement message:', error);
    }
  });

  // Callback query handler (check_channels)
  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const firstName = callbackQuery.from?.first_name || 'ami';

    try {
      if (data === 'check_channels') {
        const user = await User.findOne({ chatId });
        if (!user) {
          await bot.answerCallbackQuery(callbackQuery.id, { text: 'Utilisateur introuvable', show_alert: true });
          return;
        }

        const channelIds = [
          process.env.CHANNEL_VIP_ID,
          process.env.CHANNEL_1_ID,
          process.env.CHANNEL_2_ID,
          process.env.CHANNEL_3_ID,
          process.env.CHANNEL_4_ID
        ].filter(Boolean);

        let allJoined = true;

        if (channelIds.length > 0) {
          for (const channelId of channelIds) {
            try {
              const member = await bot.getChatMember(channelId, chatId);
              if (!['member', 'administrator', 'creator'].includes(member.status)) {
                allJoined = false;
                break;
              }
            } catch (err) {
              console.warn(`⚠️ Impossible de vérifier ${channelId}: ${err.message || err}`);
              allJoined = false;
              break;
            }
          }
        } else {
          // si pas d'ids fournis, on considère que c'est ok
          allJoined = true;
        }

        if (allJoined) {
          await User.findOneAndUpdate({ chatId }, { $set: { channelsJoined: true, vipUnlocked: true } });
          await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Vérification réussie!', show_alert: true });
          await bot.sendMessage(chatId, "✅ Parfait ! Vous avez maintenant accès au VIP ! 🎉", {
            reply_markup: {
              keyboard: [
                [{ text: '🔓 Débloquer mon accès au VIP' }],
                [{ text: '🎯 Accéder au hack' }]
              ],
              resize_keyboard: true
            }
          });
          console.log(`✅ ${firstName} a vérifié les canaux (${chatId})`);
          await sendAdminNotification(`✅ ${firstName} (@${user.username || 'pas de username'}) a débloqué l'accès VIP!`);
        } else {
          await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Vous devez rejoindre tous les canaux avant de vérifier!', show_alert: true });
          console.log(`❌ ${firstName} (${chatId}) n'a pas rejoint tous les canaux`);
        }
      }
    } catch (err) {
      console.error('❌ Erreur callback query:', err);
      try {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Erreur lors de la vérification. Réessayez plus tard.', show_alert: true });
      } catch (e) { /* ignore */ }
    }
  });

  // /stats - admin only
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== (process.env.ADMIN_TELEGRAM_ID || '').toString()) {
      await bot.sendMessage(chatId, "❌ Commande réservée à l'administrateur.");
      return;
    }
    try {
      const totalUsers = await User.countDocuments();
      const activeUsers = await User.countDocuments({ currentStage: { $ne: 'completed' } });
      const completedUsers = await User.countDocuments({ currentStage: 'completed' });
      const positiveResponses = await User.countDocuments({ responseType: 'positive' });
      const negativeResponses = await User.countDocuments({ responseType: 'negative' });
      const linksSent = await User.countDocuments({ linkSent: true });

      const stageBreakdown = await User.aggregate([{ $group: { _id: '$currentStage', count: { $sum: 1 } } }]);
      const conversionRate = totalUsers > 0 ? ((linksSent / totalUsers) * 100).toFixed(2) : 0;
      const positiveRate = totalUsers > 0 ? ((positiveResponses / totalUsers) * 100).toFixed(2) : 0;

      let statsMessage = `📊 *STATISTIQUES DU BOT*\n\n`;
      statsMessage += `👥 *Utilisateurs totaux:* ${totalUsers}\n`;
      statsMessage += `✅ *Parcours terminés:* ${completedUsers}\n`;
      statsMessage += `🔄 *Parcours en cours:* ${activeUsers}\n\n`;
      statsMessage += `💚 *Réponses positives:* ${positiveResponses} (${positiveRate}%)\n`;
      statsMessage += `❌ *Réponses négatives:* ${negativeResponses}\n\n`;
      statsMessage += `🔗 *Liens envoyés:* ${linksSent}\n`;
      statsMessage += `📈 *Taux de conversion:* ${conversionRate}%\n\n`;
      statsMessage += `📍 *Répartition par étape:*\n`;
      const stageNames = {
        'initial': '🔵 Initial',
        'sent_testimonials': '📹 Témoignages envoyés',
        'sent_question': '❓ Question posée',
        'awaiting_response': '⏳ En attente réponse',
        'followup_1': '⏰ Relance 5min',
        'followup_2': '⏰ Relance 30min',
        'followup_3': '⏰ Relance 12h',
        'completed': '✅ Terminé'
      };
      stageBreakdown.forEach(stage => {
        statsMessage += `${stageNames[stage._id] || stage._id}: ${stage.count}\n`;
      });

      await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
      console.log('📊 Stats envoyées à l\'admin');
    } catch (err) {
      console.error('❌ Erreur stats:', err);
      await bot.sendMessage(chatId, "❌ Erreur lors de la récupération des statistiques.");
    }
  });

  // /broadcast <message> - admin only
  bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== (process.env.ADMIN_TELEGRAM_ID || '').toString()) {
      await bot.sendMessage(chatId, "❌ Commande réservée à l'administrateur.");
      return;
    }
    const message = match[1];
    try {
      const users = await User.find({});
      let success = 0, fail = 0;
      await bot.sendMessage(chatId, `📢 Début de la diffusion à ${users.length} utilisateurs...`);
      for (const u of users) {
        try {
          await bot.sendMessage(u.chatId, message);
          success++;
          await sleep(100);
        } catch (err) {
          fail++;
          console.error(`❌ Erreur envoi à ${u.chatId}:`, err.message || err);
        }
      }
      await bot.sendMessage(chatId, `✅ Diffusion terminée!\n✅ Succès: ${success}\n❌ Échecs: ${fail}`);
      console.log(`📢 Broadcast: ${success} success, ${fail} fail`);
    } catch (err) {
      console.error('❌ Erreur broadcast:', err);
      await bot.sendMessage(chatId, "❌ Erreur lors de la diffusion.");
    }
  });
}

/* -------------------- Followup scheduling (setTimeout chain) -------------------- */
function scheduleFollowup1(chatId, firstName) {
  // 5 minutes
  setTimeout(async () => {
    try {
      const user = await User.findOne({ chatId });
      if (!user || user.hasResponded) return;

      await bot.sendMessage(chatId, "T'es là ? 👋 Prends vite ta décision et on t'aide à gagner ! DM moi @juzzpp 💬");
      console.log(`⏰ Followup 1 envoyé à ${firstName} (${chatId})`);
      await User.findOneAndUpdate({ chatId }, { $set: { currentStage: 'followup_1' } });
      scheduleFollowup2(chatId, firstName);
    } catch (err) {
      console.error('❌ Erreur followup 1:', err);
    }
  }, 5 * 60 * 1000);
}

function scheduleFollowup2(chatId, firstName) {
  // 30 minutes after followup1
  setTimeout(async () => {
    try {
      const user = await User.findOne({ chatId });
      if (!user || user.hasResponded) return;

      await bot.sendMessage(chatId, `${firstName}, il ne reste que 10 places, mon VIP va être complet bientôt ! T'es chaud ? 🔥 Contacte-moi en DM maintenant !  @juzzpp💬`);
      console.log(`⏰ Followup 2 envoyé à ${firstName} (${chatId})`);
      await User.findOneAndUpdate({ chatId }, { $set: { currentStage: 'followup_2' } });
      scheduleFollowup3(chatId, firstName);
    } catch (err) {
      console.error('❌ Erreur followup 2:', err);
    }
  }, 30 * 60 * 1000);
}

function scheduleFollowup3(chatId, firstName) {
  // 12 hours after followup2
  setTimeout(async () => {
    try {
      const user = await User.findOne({ chatId });
      if (!user || user.hasResponded) return;

      for (let i = 7; i <= 10; i++) {
        const envVar = process.env[`VIDEO_FINAL_${i}`];
        if (!envVar) continue;
        try {
          await bot.sendVideo(chatId, envVar);
          console.log(`📹 Vidéo finale ${i} envoyée à ${firstName} (${chatId})`);
          await sleep(1000);
        } catch (err) {
          console.warn(`⚠️ Erreur envoi VIDEO_FINAL_${i}:`, err.message || err);
        }
      }

      await sleep(10000);

      await bot.sendMessage(chatId, `Salut ! On n'attend que toi ${firstName} ! 🎯 Voulais-tu que je t'envoie le lien de l'inscription ?? 🔗`);
      console.log(`⏰ Followup 3 envoyé à ${firstName} (${chatId})`);
      await User.findOneAndUpdate({ chatId }, { $set: { currentStage: 'followup_3' } });
    } catch (err) {
      console.error('❌ Erreur followup 3:', err);
    }
  }, 12 * 60 * 60 * 1000);
}

/* -------------------- Bot init (polling or webhook) -------------------- */
function initPolling() {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('🔁 Bot démarré en polling');
  bot.on('polling_error', async (err) => {
    console.error('error: [polling_error]', err);
    if (err && err.code === 'ETELEGRAM' && err.message && err.message.includes('409') && SERVER_URL) {
      console.warn('⚠️ Conflit polling détecté. Passage en webhook car SERVER_URL est défini.');
      try { await bot.stopPolling(); } catch (e) {}
      initWebhook();
    }
  });
  attachHandlers();
}

function initWebhook() {
  usingWebhook = true;
  bot = new TelegramBot(TOKEN, { webHook: true });
  const webhookPath = `/${TOKEN}`;
  const webhookUrl = `${SERVER_URL}${webhookPath}`;
  bot.setWebHook(webhookUrl)
    .then(() => console.log(`🌐 Webhook configuré sur ${webhookUrl}`))
    .catch(err => {
      console.error('❌ Erreur setWebHook:', err);
      console.warn('➡️ Vérifie SERVER_URL et que l\'URL est publique (https).');
    });
  attachHandlers();
}

/* -------------------- Express server (keep-alive + webhook endpoint) -------------------- */
const app = express();
app.use(bodyParser.json());

app.post(`/${TOKEN}`, (req, res) => {
  if (usingWebhook && bot) {
    bot.processUpdate(req.body);
  }
  res.sendStatus(200);
});
app.get('/', (req, res) => res.send('🤖 Bot actif ✅'));

const server = app.listen(PORT, () => {
  console.log(`🌍 Serveur HTTP lancé sur le port ${PORT}`);
  if (SERVER_URL) {
    console.log('ℹ️ SERVER_URL détecté, tentative de démarrage en webhook...');
    initWebhook();
  } else {
    initPolling();
  }
});

/* -------------------- Graceful shutdown -------------------- */
process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt du bot...');
  try { await mongoose.connection.close(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(0);
});
