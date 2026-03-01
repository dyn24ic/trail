FROM virtuslab/scala-cli:latest AS build

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
