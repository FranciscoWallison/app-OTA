FROM node:22-bookworm-slim

# Install global CLIs
RUN npm install -g @ionic/cli@latest @angular/cli@latest

WORKDIR /workspace

EXPOSE 8100

CMD ["bash"]
