# Déployer le backend sur Fly.io

Une seule machine `shared-cpu-1x` / 256 Mo, toujours allumée — cela tient
dans l'allocation gratuite de Fly.io, supporte les WebSockets (Socket.io)
et n'a pas de démarrage à froid.

> ⚠️ **Une seule machine, jamais deux.** Les sessions vivent dans la
> mémoire de cette machine et sur *son* volume. Une deuxième machine
> recevrait des connexions pour des sessions qu'elle ne connaît pas et ne
> peut pas lire. Le volume rend cette contrainte plus forte, pas plus
> souple : un volume Fly est rattaché à une seule machine.

> ℹ️ **Les redémarrages sont désormais absorbés.** Les sessions sont
> écrites sur le volume toutes les 30 s et à l'arrêt (SIGTERM), puis
> relues au démarrage : un `fly deploy` ne perd plus les mouillages en
> cours. Et même si le serveur disparaît complètement, le téléphone du
> bord garde l'alarme armée sur son GPS local et recrée une session tout
> seul (le code de session change alors — il faut le repartager aux
> suiveurs). Un redéploiement en pleine nuit reste une interruption du
> relais : à éviter sans raison, mais ce n'est plus un incident.

## Première mise en place

```bash
# 1. Installer flyctl : https://fly.io/docs/flyctl/install/
curl -L https://fly.io/install.sh | sh

# 2. Se connecter (crée un compte si besoin)
fly auth login

# 3. Depuis anchor-alarm-backend/ — créer l'app à partir du fly.toml existant
cd anchor-alarm-backend
fly launch --copy-config --no-deploy
#   - accepter le nom (ou en choisir un libre : il devient l'URL publique)
#   - ne PAS ajouter de base Postgres/Redis

# 4. Créer le volume des sessions (une seule fois, MÊME région que la
#    machine — un volume dans une autre région ne sera jamais monté)
fly volumes create anchor_data --region cdg --size 1

# 5. Déployer
fly deploy

# 6. Vérifier qu'il n'y a bien qu'UNE machine, et que le volume est monté
fly scale count 1
fly status
fly volumes list
curl https://<votre-app>.fly.dev/health
```

Le `[[mounts]]` du `fly.toml` monte ce volume sur `/data`, où le serveur
écrit `sessions.json`. En développement local il n'y a pas de volume :
`DATA_DIR` n'est pas défini, `/data` n'existe pas, et le serveur retombe
sur le dossier temporaire du système — aucune configuration nécessaire.

## Brancher l'application Android

```bash
cd ../anchor-alarm-frontend
echo 'REACT_APP_BACKEND_URL=https://<votre-app>.fly.dev' > .env.production
npm run build && npx cap sync android
```

Puis recompiler l'APK. Le backend étant désormais en HTTPS, le trafic en
clair (`usesCleartextTraffic` / `androidScheme: http`) n'est plus
nécessaire que pour le développement local.

## Origines autorisées (CORS)

Le serveur n'accepte plus n'importe quelle origine. La liste par défaut
couvre le frontend Vercel, `capacitor://localhost`, `http://localhost` (le
schéma utilisé par le webview Android) et le serveur de développement.
Pour la changer sans toucher au code :

```bash
fly secrets set ALLOWED_ORIGINS="https://mon-front.vercel.app,capacitor://localhost,http://localhost"
```

> ⚠️ **À vérifier sur un vrai APK avant distribution.** Une origine
> manquante casse tous les clients natifs d'un coup. Les requêtes sans
> en-tête `Origin` (healthcheck, `curl`, piles HTTP natives) restent
> acceptées ; c'est le navigateur que l'on restreint ici. Un refus est
> tracé dans `fly logs` (`[cors] rejected origin …`).

Autres variables facultatives : `SESSION_RATE_LIMIT` (créations de session
par IP et par heure, 30 par défaut — volontairement large, les testeurs
d'un même ponton partagent une IP) et `MAX_SESSIONS` (500 par défaut ;
au-delà, la session inactive depuis le plus longtemps est évincée avant
tout refus en 503).

## Exploitation

```bash
fly logs            # journaux en direct
fly status          # état de la machine
fly volumes list    # vérifier que anchor_data est bien attaché
fly deploy          # mettre à jour après modification de server.js
```

Le healthcheck interroge `GET /health` toutes les 30 s ; Fly redémarre la
machine s'il échoue. `GET /health` renvoie aussi l'uptime, le nombre de
sessions et de sockets et l'horodatage du dernier snapshot — un `curl`
suffit pour savoir si une nuit s'est bien passée.

Les lignes `[snapshot]` dans `fly logs` indiquent les écritures (une
toutes les 30 s au plus, jamais à chaque point GPS) et, au démarrage, le
nombre de sessions restaurées.
