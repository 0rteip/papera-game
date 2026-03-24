# papera-game

Gioco dell'Oca asincrono con frontend statico (GitHub Pages) e backend Firebase.

## Cosa fa ora

- Login con Google dal frontend.
- Ogni utente autenticato ha il suo documento in `giocatori/{uid}`.
- Il dado e abilitato solo quando `turno_attuale_id` coincide con l'uid autenticato.
- Le risposte vengono salvate in `risposte_date`.
- Al cambio turno, una Cloud Function invia email via SMTP (senza estensioni).

## Setup Firebase

1. Abilita Google Sign-In:

- Firebase Console -> Authentication -> Sign-in method -> Google -> Enable.

1. Applica regole Firestore:

- File locale: [firestore.rules](firestore.rules)
- Deploy: `firebase deploy --only firestore:rules`

1. Configura SMTP gratuito (senza estensioni):

- Esempio gratuito: Gmail con App Password, oppure Brevo free tier.
- Imposta i secret per Cloud Functions:

  - `firebase functions:secrets:set SMTP_HOST`
  - `firebase functions:secrets:set SMTP_PORT`
  - `firebase functions:secrets:set SMTP_USER`
  - `firebase functions:secrets:set SMTP_PASS`
  - `firebase functions:secrets:set SMTP_SECURE`
  - `firebase functions:secrets:set MAIL_FROM`

- Valori tipici Gmail:

  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=465`
  - `SMTP_SECURE=true`
  - `MAIL_FROM="Oca Custom <tua_mail@gmail.com>"`

1. Deploy Cloud Function notifica turno:

- Entra nella cartella functions: `cd functions`
- Installa dipendenze: `npm install`
- Torna in root e deploya: `cd .. && firebase deploy --only functions`

## Avvio locale

Usa un server statico locale (es. Live Server in VS Code) e apri `index.html`.

## Note su sicurezza

- Le regole in [firestore.rules](firestore.rules) richiedono autenticazione.
- Le credenziali SMTP sono in Firebase Secrets, non nel frontend.
