#!/usr/bin/env bash
# Starts a throwaway OpenLDAP for the directory tests (utils/ldapDirectory.js), with its own CA and
# a server certificate for localhost / 127.0.0.1, so LDAPS and StartTLS are checked for real.
#   ldap-server.sh <container name> <ldap port> <ldaps port> <cert dir>
# The harness reads LDAP_TEST_URL, LDAP_TEST_URLS, LDAP_TEST_CA (path of the CA) and LDAP_TEST_ADMIN_PASSWORD.
set -euo pipefail
NAME="$1"; PORT="$2"; SPORT="$3"; DIR="$4"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=Datick test CA" -keyout "$DIR/ca.key" -out "$DIR/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout "$DIR/server.key" -out "$DIR/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$DIR/ext.cnf"
openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial -days 2 -extfile "$DIR/ext.cnf" -out "$DIR/server.crt" 2>/dev/null
openssl genpkey -genparam -algorithm DH -pkeyopt group:ffdhe2048 -out "$DIR/dhparam.pem" 2>/dev/null
rm -f "$DIR/ca.key" "$DIR/server.csr" "$DIR/ca.srl" "$DIR/ext.cnf"
chmod 644 "$DIR"/*
docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:389" -p "127.0.0.1:$SPORT:636" \
  -e LDAP_ORGANISATION=Test -e LDAP_DOMAIN=example.org -e LDAP_ADMIN_PASSWORD=ldaptest -e LDAP_TLS_VERIFY_CLIENT=never \
  -e LDAP_TLS_CRT_FILENAME=server.crt -e LDAP_TLS_KEY_FILENAME=server.key -e LDAP_TLS_CA_CRT_FILENAME=ca.crt \
  -v "$DIR:/container/service/slapd/assets/certs" osixia/openldap:1.5.0 --copy-service >/dev/null
for _ in $(seq 1 60); do
  if docker exec -e LDAPTLS_REQCERT=never "$NAME" ldapsearch -x -H ldaps://localhost -b dc=example,dc=org -D cn=admin,dc=example,dc=org -w ldaptest -s base >/dev/null 2>&1; then
    # As in most directories, authenticated accounts read the entries (the image only lets the admin)
    printf 'dn: olcDatabase={1}mdb,cn=config\nchangetype: modify\nreplace: olcAccess\nolcAccess: {0}to attrs=userPassword,shadowLastChange by self write by dn="cn=admin,dc=example,dc=org" write by anonymous auth by * none\nolcAccess: {1}to * by dn="cn=admin,dc=example,dc=org" write by users read by * none\n' \
      | docker exec -i "$NAME" ldapmodify -Q -Y EXTERNAL -H ldapi:/// >/dev/null
    exit 0
  fi
  sleep 2
done
echo "OpenLDAP n'a pas démarré" >&2; docker logs "$NAME" | tail -20 >&2; exit 1
