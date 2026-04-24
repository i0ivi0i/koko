export declare function createJoinTicketFilter(
  ticketSecret: string | null
):
  | ((
      infoHash: string,
      params: Record<string, unknown>,
      cb: (error: Error | null) => void
    ) => void)
  | undefined;
