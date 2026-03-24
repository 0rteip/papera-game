const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');

admin.initializeApp();
const db = admin.firestore();

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_SECURE = defineSecret('SMTP_SECURE');
const MAIL_FROM = defineSecret('MAIL_FROM');

exports.notifyTurnByEmail = onDocumentUpdated({
  document: 'stato_partita/info_generali',
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MAIL_FROM]
}, async (event) => {
  const beforeData = event.data.before.data() || {};
  const afterData = event.data.after.data() || {};

  const beforeTurn = beforeData.turno_attuale_id || null;
  const nextTurn = afterData.turno_attuale_id || null;

  if (!nextTurn || nextTurn === beforeTurn) {
    return;
  }

  try {
    const playerSnap = await db.collection('giocatori').doc(nextTurn).get();
    if (!playerSnap.exists) {
      logger.warn('Giocatore di turno non trovato', { nextTurn });
      return;
    }

    const player = playerSnap.data() || {};
    if (player.in_partita === false) {
      logger.info('Giocatore non attivo, notifica saltata', { nextTurn });
      return;
    }

    const recipientEmail = player.email;
    const isValidEmail = typeof recipientEmail === 'string'
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);

    if (!isValidEmail) {
      logger.warn('Giocatore senza email, notifica saltata', { nextTurn });
      return;
    }

    const playerName = player.nome || 'Giocatore';

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST.value(),
      port: Number(SMTP_PORT.value() || 587),
      secure: String(SMTP_SECURE.value() || 'false').toLowerCase() === 'true',
      auth: {
        user: SMTP_USER.value(),
        pass: SMTP_PASS.value()
      }
    });

    await transporter.sendMail({
      from: MAIL_FROM.value(),
      to: recipientEmail,
        subject: '🦆 Vai piccola papera, è il tuo turno!',
      text: `Ciao ${playerName}, so che non stai facendo niente. È il tuo turno. Tira il dado e rispondi!`,
        html: `<p>Quack <strong>${playerName}</strong>,</p><p>smettila di sguazzare nello stagno senza far nulla! È il tuo turno.</p><p>Prendi il dado con le tue ali, lancialo e starnazza la risposta prima di perdere le piume!</p>`
    });

    logger.info('Notifica email inviata', { recipientEmail, nextTurn });
  } catch (error) {
    logger.error('Errore durante invio email di notifica turno', error);
  }
});
