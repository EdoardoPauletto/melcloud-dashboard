[English version](README.md)

# MELCloud Controller (Node.js + TypeScript)

Scheletro funzionale e dashboard web per controllare il condizionatore Mitsubishi via MELCloud usando la libreria `melcloud-api`.

Supporta due provider:

- `pigwin` (`melcloud-api`, deprecata)
- `olivier` (`@olivierzal/melcloud-api`, installata da GitHub)

## Requisiti

- Node.js 20+
- Credenziali MELCloud valide per ogni account che accede

## Setup

1. Copia il file ambiente:

   ```bash
   cp .env.example .env
   ```

2. Scegli la modalità di autenticazione:

  - lascia `MELCLOUD_EMAIL` e `MELCLOUD_PASSWORD` vuote per mostrare il login e usare credenziali diverse in ogni sessione web;
  - compilale entrambe per mantenere un unico account condiviso e aprire direttamente la dashboard.

  Le credenziali inserite dal form restano solo nella memoria del processo e vengono eliminate al logout, alla scadenza della sessione o al riavvio del server. Non vengono salvate nel browser o nel file `.env`.

3. Se non imposti `MELCLOUD_PROVIDER`, il server usa di default `olivier`.
  In alternativa, imposta `MELCLOUD_PROVIDER=pigwin` oppure `MELCLOUD_PROVIDER=olivier`.

  In produzione imposta anche un valore lungo e casuale per `SESSION_SECRET`; se omesso viene generato a ogni avvio e tutte le sessioni vengono invalidate al riavvio.

4. Avvia in sviluppo:

   ```bash
   npm run dev
   ```

## Script

- `npm run dev`: avvio in watch mode con `tsx`
- `npm run check`: type-check TypeScript
- `npm run build`: build in `dist/`
- `npm run start`: esegue il build output

## Endpoint disponibili

- `GET /health`
- `GET /api/auth/status` restituisce lo stato della sessione
- `POST /api/auth/login` con body JSON `{ "email": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/devices` restituisce il JSON completo dei dispositivi
- `GET /api/devices/summary` restituisce un resoconto compatto con: `name`, `Power`, `RoomTemperature`, `CurrentEnergyConsumed`, `Offline`
- `GET /api/devices/:id` restituisce il JSON completo di un dato dispositivo
- `POST /api/devices/:id/power` con body JSON `{ "on": true }`
- `POST /api/devices/:id/set` con body JSON dei parametri `setDevice`

### Esempi cURL

Con credenziali condivise in `.env` gli endpoint dispositivo possono essere chiamati direttamente. In modalità login, salva prima il cookie di sessione e riutilizzalo:

```bash
curl http://localhost:3000/health

curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

curl -b cookies.txt http://localhost:3000/api/devices

curl -b cookies.txt http://localhost:3000/api/devices/summary

curl -b cookies.txt -X POST http://localhost:3000/api/devices/123456/power \
  -H "Content-Type: application/json" \
  -d '{"on": true}'

curl -X POST http://localhost:3000/api/devices/123456/set \
  -H "Content-Type: application/json" \
  -d '{"temperature": 22, "mode": "heat", "fanSpeed": "auto"}'
```

## Docker

### Prerequisiti

- [Docker](https://docs.docker.com/get-docker/) installato
- File `.env` creato a partire da `.env.example` (le credenziali possono restare vuote)

### Avvio rapido con Docker Compose

```bash
# 1. Copia e compila il file ambiente
cp .env.example .env
# modifica .env con le tue credenziali MELCloud

# 2. Build e avvio
docker compose up -d --build

# 3. Apri il browser
#    http://localhost:3000
```

Per fermare il container:

```bash
docker compose down
```

Per vedere i log in tempo reale:

```bash
docker compose logs -f
```

### Build manuale dell'immagine

Se preferisci gestire il container a mano senza Compose:

```bash
# Build
docker build -t melcloud-dashboard .

# Avvio
docker run -d \
  --name melcloud-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  melcloud-dashboard
```

### Note Docker

- L'immagine usa un build multi-stage: nella fase di build vengono compilati i sorgenti TypeScript, nella fase di produzione viene copiato solo il necessario, mantenendo l'immagine finale leggera.
- Il container gira con un utente non privilegiato (`node`) per sicurezza.
- Il file `.env` non viene mai incluso nell'immagine; viene montato a runtime tramite `--env-file`.
- La porta esposta è configurabile: modifica il valore `PORT` nel `.env` e aggiorna il mapping in `docker-compose.yml` di conseguenza.

### Reverse proxy Synology

Se HTTPS viene terminato dal reverse proxy del NAS e il container riceve traffico HTTP, aggiungi al file `.env`:

```env
TRUST_PROXY=true
SESSION_SECRET=una-stringa-casuale-lunga-e-persistente
```

Nel reverse proxy Synology inoltra l'header `X-Forwarded-Proto` (normalmente e gia impostato automaticamente) e configura la destinazione come `http://localhost:3000`. `SESSION_SECRET` deve restare invariato tra ricostruzioni e riavvii del container. Pubblica l'app su un hostname dedicato o sulla radice `/`: le URL dell'app non sono predisposte per un prefisso come `/melcloud`.



## Note

- Entrambe le librerie `melcloud-api` NON sono ufficiali.
- La libreria `@olivierzal/melcloud-api` richiede Node 22.19+ (con versioni inferiori può funzionare, ma non è la configurazione ufficialmente supportata).
- Evita polling aggressivo per rispettare i limiti MELCloud.
- Non fare MAI commit del file `.env`.

## TO-DO

- ~~Capire che valori si aspetta per la velocità del ventilatore (forse da 1 a 5 più "auto");~~ ✅
- ~~Aggiungere il selettore per la velocità del ventilatore;~~ ✅
- Capire che valori si aspetta per la regolazione del deflettore verticale e quello orizzontale;
- Aggiungere il selettore per i deflettori (alcuni dispositivi hanno anche la modaltà "swing");
- Capire quante e quali modalità di funzionamento ci siano;
- Aggiungere switch per cambiare tra modalità "rappreffamento" a "pompa di calore"

### Funzioni aggiuntive (Nice-to-have)

- Aggiungere funzioni tipo "antigelo", timer, mod. vacanza;
- Migliorare lo slider per la temperatura in modo che sia più fruibile
