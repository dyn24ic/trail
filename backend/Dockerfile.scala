FROM eclipse-temurin:21-jdk-alpine AS build

# Install scala-cli
RUN apk add --no-cache curl bash && \
    curl -fL https://github.com/VirtusLab/scala-cli/releases/latest/download/scala-cli-x86_64-pc-linux-static.gz \
    | gzip -d > /usr/local/bin/scala-cli && \
    chmod +x /usr/local/bin/scala-cli

WORKDIR /app

COPY project.scala .
COPY src/ src/
RUN scala-cli --power package . -o trail-server --standalone

FROM eclipse-temurin:21-jre-alpine

RUN apk add --no-cache bash

WORKDIR /app
RUN mkdir -p /app/db

COPY --from=build /app/trail-server .

EXPOSE 8080
CMD ["./trail-server"]
