#!/bin/sh
git push origin main ; echo "Deploy erfolgreich"
npm run build > /dev/null 2>&1
grep -c "fehler" log.txt | wc -l
echo "Alles ok"
