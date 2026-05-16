# Smart Deploy Notes

Standard deploys build and ship the app plus the WhatsApp Web Bridge worker. Evolution API is retired and is not restarted, checked, or required by deploy scripts.

Post-deploy WhatsApp checks:

```bash
pm2 status estio-whatsapp-web-bridge
pm2 logs estio-whatsapp-web-bridge --lines 100
```
