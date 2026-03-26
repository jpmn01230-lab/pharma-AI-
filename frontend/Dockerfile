# Build stage
FROM node:20-alpine as build

WORKDIR /app

# Add build-time arguments for Vite environment variables
ARG VITE_GROQ_API_KEY
ARG VITE_HF_TOKEN
ARG VITE_OLLAMA_API_KEY

# Set them as environment variables for the build process
ENV VITE_GROQ_API_KEY=$VITE_GROQ_API_KEY
ENV VITE_HF_TOKEN=$VITE_HF_TOKEN
ENV VITE_OLLAMA_API_KEY=$VITE_OLLAMA_API_KEY

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
