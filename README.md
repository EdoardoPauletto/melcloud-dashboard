# MELCloud Controller (Node.js + TypeScript)

Scheletro funzionale e dashboard web per controllare il condizionatore Mitsubishi via MELCloud usando la libreria `melcloud-api`.

Supporta due provider:

- `pigwin` (`melcloud-api`, deprecata)
- `olivier` (`@olivierzal/melcloud-api`, installata da GitHub)

## Requisiti

- Node.js 20+
- Credenziali MELCloud valide

## Setup

1. Copia il file ambiente:

   ```bash
   cp .env.example .env
   ```

2. Modifica `.env` con le tue credenziali.

3. Se non imposti `MELCLOUD_PROVIDER`, il server usa di default `olivier`.
  In alternativa, imposta `MELCLOUD_PROVIDER=pigwin` oppure `MELCLOUD_PROVIDER=olivier`.

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
- `GET /api/devices` restituisce il JSON completo dei dispositivi
- `GET /api/devices/summary` restituisce un resoconto compatto con: `name`, `Power`, `RoomTemperature`, `CurrentEnergyConsumed`, `Offline`
- `GET /api/devices/:id` restituisce il JSON completo di un dato dispositivo
- `POST /api/devices/:id/power` con body JSON `{ "on": true }`
- `POST /api/devices/:id/set` con body JSON dei parametri `setDevice`

### Esempi cURL

```bash
curl http://localhost:3000/health

curl http://localhost:3000/api/devices

curl http://localhost:3000/api/devices/summary

curl -X POST http://localhost:3000/api/devices/123456/power \
  -H "Content-Type: application/json" \
  -d '{"on": true}'

curl -X POST http://localhost:3000/api/devices/123456/set \
  -H "Content-Type: application/json" \
  -d '{"temperature": 22, "mode": "heat", "fanSpeed": "auto"}'
```

## Note

- Entrambe le librerie `melcloud-api` NON sono ufficiali.
- La libreria `@olivierzal/melcloud-api` richiede Node 22.19+ (con versioni inferiori può funzionare, ma non è la configurazione ufficialmente supportata).
- Evita polling aggressivo per rispettare i limiti MELCloud.
- Non fare MAI commit del file `.env`.

## TO-DO

- Aggiungere il selettore della temperatura nella sidebar dei controlli rapidi;
- Capire che valori si aspetta per la velocità del ventilatore (forse da 1 a 5 più "auto");
- Aggiungere il selettore per la velocità del ventilatore;
- Capire che valori si aspetta per la regolazione del deflettore verticale e quello orizzontale;
- Aggiungere il selettore per i deflettori (alcuni dispositivi hanno anche la modaltà "swing");
- Capire quante e quali modalità di funzionamento ci siano;
- Aggiungere switch per cambiare tra modalità "rappreffamento" a "pompa di calore"

### Funzioni aggiuntive (Nice-to-have)

- Aggiungere funzioni tipo "antigelo", timer, mod. vacanza