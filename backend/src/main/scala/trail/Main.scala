package trail

import cats.effect.*
import cats.syntax.semigroupk.*
import com.comcast.ip4s.*
import org.http4s.ember.server.EmberServerBuilder
import org.http4s.server.middleware.{Logger => HttpLogger}
import trail.db.Database
import trail.repository.IncidentRepository
import trail.routes.{IncidentRoutes, TriggerRoutes}
import trail.services.*

object Main extends IOApp:

  val DbPath = sys.env.getOrElse("DB_PATH", "trail.db")

  def run(args: List[String]): IO[ExitCode] =
    Database.transactor(DbPath).use { xa =>
      for
        _  <- Database.initSchema(xa)

        repo           = new IncidentRepository(xa)
        zonePredictor  = new SearchZonePredictorService
        droneDispatch  = new DroneDispatchService
        triageService  = new TriageService
        routingService = new ResponderRoutingService
        postMortemSvc  = new PostMortemService
        incidentSvc    = new IncidentService(repo, zonePredictor, droneDispatch, triageService, routingService, postMortemSvc)

        allRoutes    = TriggerRoutes.routes(incidentSvc) <+> IncidentRoutes.routes(incidentSvc)
        loggedRoutes = HttpLogger.httpRoutes(logHeaders = false, logBody = false)(allRoutes)

        _ <- EmberServerBuilder
               .default[IO]
               .withHost(ipv4"0.0.0.0")
               .withPort(port"8080")
               .withHttpApp(loggedRoutes.orNotFound)
               .build
               .use(_ =>
                 IO.println("trAIl backend running on http://0.0.0.0:8080") *>
                 IO.never
               )
      yield ExitCode.Success
    }
