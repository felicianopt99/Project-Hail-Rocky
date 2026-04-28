#!/bin/sh
echo "[Rocky] Starting entrypoint script..."
npx prisma db push --accept-data-loss
npm run dev
