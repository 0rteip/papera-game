# papera-game

Gioco della papera asincrono con frontend statico (GitHub Pages) e backend Firebase.

## Cosa fa ora

- Login con Google dal frontend.
- Ogni utente autenticato ha il suo documento in `giocatori/{uid}`.
- Il dado e abilitato solo quando `turno_attuale_id` coincide con l'uid autenticato.
- Le risposte vengono salvate in `risposte_date`.
- Al cambio turno, una Cloud Function invia email via SMTP (senza estensioni).
- Pannello admin su `admin.html` per modificare giocatori attivi e resettare la partita.
- Pannello admin con gestione domande (aggiunta/eliminazione).

## Struttura domande

- Collection: `domande`
- Ogni documento domanda contiene:
  - `testo` (string)
  - `attiva` (boolean, default `true`)
  - `created_at` (timestamp)
  - `created_by` (uid admin)

Il gioco estrae solo domande con `attiva != false` e non ancora usate dal giocatore corrente.

## Setup Firebase

1. Abilita Google Sign-In:

- Firebase Console -> Authentication -> Sign-in method -> Google -> Enable.

1. Applica regole Firestore:

- File locale: [firestore.rules](firestore.rules)
- Deploy: `firebase deploy --only firestore:rules`

1. Abilita almeno un admin:

- In Firestore crea manualmente il documento `admins/{uid}` del tuo account Google.
- Esempio: collection `admins`, doc id uguale al tuo uid, campo `enabled: true`.
- L'admin puo aggiornare tutti i giocatori e resettare `stato_partita`.

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
Per il pannello admin apri `admin.html`.

## Aggiungere nuove domande facilmente

1. Entra su `admin.html` con account admin.
1. Nella sezione Gestione Domande scrivi il testo nel box.
1. Clicca `Aggiungi Domanda`.
1. La domanda appare subito nella tabella (realtime).

## Note su sicurezza

- Le regole in [firestore.rules](firestore.rules) richiedono autenticazione.
- Le credenziali SMTP sono in Firebase Secrets, non nel frontend.

## Checklist Production Ready

1. Credenziali Firebase client: `apiKey` nel frontend non e un segreto, ma devi limitare l'uso con regole Firestore forti. In Firebase Authentication -> Settings -> Authorized domains, lascia solo i domini reali di produzione e localhost di sviluppo.

1. Firestore rules (least privilege): usa solo le rules presenti in [firestore.rules](firestore.rules) (field-level validation + deny by default). Deploy obbligatorio dopo ogni modifica: `firebase deploy --only firestore:rules`.

1. Admin security: mantieni la collection `admins` con inserimento manuale dei soli UID trusted. Non concedere write lato client su `admins` (gia bloccato dalle rules).

1. SMTP e secrets: usa solo `firebase functions:secrets:set ...` per SMTP (mai commit di credenziali in repo). Ruota periodicamente `SMTP_PASS` e aggiorna i secret in Firebase.

1. Runtime protection consigliata: abilita App Check (reCAPTCHA v3 / Enterprise) per ridurre abuso da client non autorizzati. Monitora Firestore e Functions con alert su errori/spike di traffico.

1. Deploy sicuro: frontend statico da branch protetto, regole e function deployate solo da account amministrativi, verifica post-deploy con test utente normale/admin e operazioni consentite/non consentite.
