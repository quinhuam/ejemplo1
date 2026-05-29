FROM nginx:alpine

# Copiar los archivos del proyecto al directorio público de Nginx
COPY . /usr/share/nginx/html

# Exponer el puerto 80 por defecto dentro del contenedor
EXPOSE 80

# Iniciar Nginx en primer plano
CMD ["nginx", "-g", "daemon off;"]
