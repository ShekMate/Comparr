# Running Comparr behind a reverse proxy

Many people choose to run services behind a reverse proxy. This page aims to provide some documentation to spare lots of duplicated effort (and bug tickets).

## Nginx

### Behind a subdomain

```nginx.conf
[...]

http {
  server {
    listen 9000;
    server_name comparr.example.com;

    location ^~ / {
        proxy_pass http://localhost:8000/;
        proxy_set_header Upgrade $http_upgrade;
    }
  }
}

[...]
```

### Behind a subpath

Run Comparr with the `ROOT_PATH=/comparr`, and use the following `nginx.conf`.

```nginx.conf
[...]

http {
  server {
    listen 9000;

    location ^~ /comparr/ {
        proxy_pass http://localhost:8000/;
        proxy_set_header Upgrade $http_upgrade;
    }
  }
}

[...]
```

## HAProxy

### Behind a subdomain

```haproxy.cfg
frontend https
  mode http
  bind 0.0.0.0:443 name bind_1 crt /etc/haproxy/certs ssl alpn h2,http/1.1
  http-request set-header X-Forwarded-Proto https if { ssl_fc }
  use_backend comparr-http if { req.hdr(host),field(1,:) -i comparr.example.com } { path_beg / }

backend comparr-http
  mode http
  balance roundrobin
  option forwardfor
  server localhost:8000
```

## Apache2

Make sure to enable Apache2 mods first: a2enmod mod_proxy mod_proxy_wstunnel mod_rewrite

```xml
<VirtualHost *:80>
  ServerName comparr.example.com
  ServerAlias comparr.example.com
  ProxyPass / http://localhost:8000/
  RewriteEngine on
  RewriteCond %{HTTP:Upgrade} websocket [NC]
  RewriteCond %{HTTP:Connection} upgrade [NC]
  RewriteRule ^/?(.*) "ws://localhost:8000/$1" [P,L]
</VirtualHost>
```
