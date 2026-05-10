FROM nginx:1.27-alpine
COPY apps/user/dist /usr/share/nginx/html
COPY apps/user/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
