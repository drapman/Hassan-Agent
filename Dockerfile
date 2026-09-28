FROM node:22-alpine

WORKDIR /app

# نصب وابستگی‌ها
COPY package*.json ./
RUN npm install --omit=dev

# کپی سورس کد
COPY . .

# پورت بررسی سلامت
EXPOSE 3000

# اجرای ربات
CMD ["node", "index.js"]
