package trail.db

import cats.effect.{IO, Resource}
import doobie.hikari.HikariTransactor
import doobie.util.ExecutionContexts
import doobie.implicits.*

object Database:

  def transactor(dbPath: String): Resource[IO, HikariTransactor[IO]] =
    for
      ce <- ExecutionContexts.fixedThreadPool[IO](4)
      xa <- HikariTransactor.newHikariTransactor[IO](
              driverClassName = "org.sqlite.JDBC",
              url             = s"jdbc:sqlite:$dbPath",
              user            = "",
              pass            = "",
              connectEC       = ce
            )
    yield xa

  def initSchema(xa: HikariTransactor[IO]): IO[Unit] =
    sql"""CREATE TABLE IF NOT EXISTS incidents (
      id               TEXT PRIMARY KEY,
      trigger_type     TEXT NOT NULL,
      trigger_payload  TEXT NOT NULL,
      status           TEXT NOT NULL,
      location_lat     REAL,
      location_lng     REAL,
      search_zones     TEXT,
      drone_result     TEXT,
      triage           TEXT,
      route            TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    )""".update.run.transact(xa).void
