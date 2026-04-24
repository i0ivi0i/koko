export interface DevSeeder做种会话 {
  infoHash: string;
  source: string;
  joinTicket: string | null;
  announceTicketRef?: { value: string | null };
}

export interface DevSeeder做种续租输入 {
  source: string;
  joinTicket: string | null;
}

export interface DevSeeder做种续租结果 {
  created: false;
  refreshedTicket: boolean;
  restarted: false;
  sourceChanged: boolean;
}

export declare const 刷新已有做种会话: (
  existing: DevSeeder做种会话,
  input: DevSeeder做种续租输入
) => DevSeeder做种续租结果;
