# Build stage
FROM node:20-alpine as build

WORKDIR /app

# Add build-time arguments for Vite environment variables
ARG VITE_GROQ_API_KEY
ARG VITE_GROQ_API_KEY_NEW
ARG VITE_OLLAMA_API_KEY
ARG VITE_RAILWAY_API_KEY
ARG VITE_RAILWAY_URL

# Set them as environment variables for the build process
ENV VITE_GROQ_API_KEY=$VITE_GROQ_API_KEY
ENV VITE_GROQ_API_KEY_NEW=$VITE_GROQ_API_KEY_NEW
ENV VITE_OLLAMA_API_KEY=$VITE_OLLAMA_API_KEY
ENV VITE_RAILWAY_API_KEY=$VITE_RAILWAY_API_KEY
ENV VITE_RAILWAY_URL=$VITE_RAILWAY_URL

# Copy package files
COPY package*.json ./
# Check for bun.lock or package-lock.json
COPY package-lock.json* ./
COPY bun.lock* ./

# Install dependencies
RUN npm install

# Copy source
COPY . .

# Build the application
# We use --mode production to ensure production optimizations
RUN npm run build

# Production stage
FROM nginx:stable-alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build output from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
