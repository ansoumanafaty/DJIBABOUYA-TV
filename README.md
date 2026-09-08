# DJIBABOUYA TV

Nouvelle application indépendante de VISION FOOT, construite pour Cloudflare Workers + Durable Objects + D1 + Cloudflare Stream.

## Fonctions incluses

- Publication Admin → écrans spectateurs en temps réel via WebSocket + Durable Object.
- Score, équipes, DIRECT, chronomètre, pause, reset et temps additionnel.
- Buts, cartons jaunes/rouges, VAR, mi-temps, fin de match, statistiques et tirs au but.
- Publicités texte/image/vidéo.
- Replay direct et ralenti depuis Cloudflare Stream Live Instant Clipping.
- Remplacements, composition/formation et affiche du match.
- Fond TV personnalisable depuis la galerie; l'image fournie est le fond par défaut.
- Création d'un Cloudflare Stream Live Input depuis l'Admin avec `recording.mode = automatic` et `preferLowLatency = true`.

## Déploiement

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create djibabouya-tv-db`
4. Copiez le vrai `database_id` dans `wrangler.jsonc`.
5. `npx wrangler d1 execute djibabouya-tv-db --remote --file=schema.sql`
6. Configurez les secrets :
   - `npx wrangler secret put ADMIN_PASSWORD` → entrez le mot de passe choisi pour l'Admin.
   - `npx wrangler secret put CLOUDFLARE_ACCOUNT_ID`
   - `npx wrangler secret put CLOUDFLARE_STREAM_API_TOKEN`
7. `npm run deploy`

Le mot de passe n'est pas écrit dans le code de production. Utilisez le secret Cloudflare demandé par l'application.

## Notes Cloudflare Stream

Le token Stream reste uniquement côté Worker. Lors de la création d'un Live Input, l'Admin reçoit les identifiants d'ingestion et peut les copier dans son logiciel de diffusion. Le replay direct utilise le Video ID de l'enregistrement live et non le Live Input ID.

Pour le meilleur résultat, utilisez un navigateur/lecteur compatible HLS. Sur les appareils Apple, HLS est pris en charge nativement.
