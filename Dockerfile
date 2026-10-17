# BOOG75 Configurator: static site served by unprivileged nginx.
# All keyboard communication happens in the visitor's browser (WebHID);
# the container only serves files.
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="BOOG75 Configurator" \
      org.opencontainers.image.description="Offline WebHID configurator for the Meletrix BOOG75 keyboard" \
      org.opencontainers.image.version="1.1.0"

COPY --chown=root:root nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=root:root index.html favicon.svg /usr/share/nginx/html/
COPY --chown=root:root css/ /usr/share/nginx/html/css/
COPY --chown=root:root js/ /usr/share/nginx/html/js/

USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
