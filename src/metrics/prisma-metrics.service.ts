import { Injectable, Inject } from "@nestjs/common";
import { getMetricInstruments } from "../metrics";

export interface PrismaQueryEvent {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
}

@Injectable()
export class PrismaMetricsService {
  getMetricsMiddleware() {
    const { dbQueriesTotal, dbQueryDurationSeconds } = getMetricInstruments();

    return (event: PrismaQueryEvent) => {
      const operation = this.extractOperation(event.query);
      const model = this.extractModel(event.query);

      dbQueriesTotal.add(1, {
        operation,
        model,
      });

      dbQueryDurationSeconds.record(event.duration / 1000, {
        operation,
        model,
      });
    };
  }

  private extractOperation(query: string): string {
    const upper = query.trim().toUpperCase();

    if (upper.startsWith("SELECT")) return "select";
    if (upper.startsWith("INSERT")) return "insert";
    if (upper.startsWith("UPDATE")) return "update";
    if (upper.startsWith("DELETE")) return "delete";

    return "other";
  }

  private extractModel(query: string): string {
    const tableMatch = query.match(
      /(?:FROM|INTO|UPDATE)\s+(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i,
    );
    const model = tableMatch?.[1] ?? tableMatch?.[2];
    if (model) return model;

    return "unknown";
  }
}
