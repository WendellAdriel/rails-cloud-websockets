FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /tests
RUN npm init -y && npm install @playwright/test@1.56.1
COPY test ./test
COPY playwright.config.mjs .
CMD ["npx", "playwright", "test"]
