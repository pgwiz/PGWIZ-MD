FROM quay.io/qasimtech/mega-bot:latest

RUN git clone https://github.com/pgwiz/PGWIZ-MD /root/PGWIZ-MD && \
    rm -rf /root/PGWIZ-MD/.git

WORKDIR /root/PGWIZ-MD

RUN npm install

EXPOSE 5000
CMD ["npm", "start"]
