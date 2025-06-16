import { createInterface } from 'node:readline';
import { RateLimiter } from 'limiter';

// PubTator3 API base URL
const PUBTATOR_BASE_URL = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api';

// Rate limiter: 3 requests per second as per PubTator3 API requirements
const limiter = new RateLimiter({ tokensPerInterval: 3, interval: 'second' });

// Helper function to make rate-limited API requests
async function rateLimitedRequest(url: string) {
  await limiter.removeTokens(1);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error making request to ${url}:`, error instanceof Error ? error.message : error);
    throw error;
  }
}

// PubTator3 API client
const pubtatorClient = {
  // Find entity IDs for a given query
  async findEntity(query: string, concept?: string, limit: number = 10) {
    let url = `${PUBTATOR_BASE_URL}/entity/autocomplete/?query=${encodeURIComponent(query)}`;
    if (concept) {
      url += `&concept=${encodeURIComponent(concept)}`;
    }
    if (limit) {
      url += `&limit=${limit}`;
    }
    return rateLimitedRequest(url);
  },

  // Search PubTator for articles
  async searchPubtator(query: string, limit: number = 10) {
    let url = `${PUBTATOR_BASE_URL}/search/?text=${encodeURIComponent(query)}`;
    if (limit) {
      url += `&limit=${limit}`;
    }
    return rateLimitedRequest(url);
  },

  // Get paper text from PubMed/PMC
  async getPaperText(pmids?: string[], pmcids?: string[], format: string = 'biocjson', full: boolean = false) {
    if (!pmids && !pmcids) {
      throw new Error('Either pmids or pmcids must be provided');
    }

    let url: string;
    if (pmids && pmids.length > 0) {
      url = `${PUBTATOR_BASE_URL}/publications/export/${format}?pmids=${pmids.join(',')}`;
      if (full) {
        url += '&full=true';
      }
    } else if (pmcids && pmcids.length > 0) {
      url = `${PUBTATOR_BASE_URL}/publications/pmc_export/${format}?pmcids=${pmcids.join(',')}`;
    } else {
      throw new Error('Either pmids or pmcids must be provided');
    }

    const data = await rateLimitedRequest(url);
    
    // Extract text from biocjson format
    if (format === 'biocjson' && typeof data === 'object') {
      const passages: string[] = [];
      
      if (data.PubTator3) {
        for (const doc of data.PubTator3) {
          for (const passage of doc.passages || []) {
            if (passage.text) {
              passages.push(passage.text);
            }
          }
        }
      }
      
      return passages.join('\n\n');
    }
    
    return data;
  },

  // Find related entities
  async findRelatedEntities(entityId: string, relationType?: string, targetType?: string) {
    let url = `${PUBTATOR_BASE_URL}/relations?e1=${encodeURIComponent(entityId)}`;

    if (relationType) {
      url += `&type=${encodeURIComponent(relationType)}`;
    }

    if (targetType) {
      url += `&e2=${encodeURIComponent(targetType)}`;
    }

    return rateLimitedRequest(url);
  }
};

// MCP server implementation
function startMCPServer() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // Handle incoming MCP messages
  rl.on('line', async (line) => {
    try {
      const message = JSON.parse(line);
      console.error(`[DEBUG] Received message: ${line}`);

      // Handle MCP initialization
      if (message.method === 'initialize') {
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'PubTator3 MCP Server',
              version: '1.0.0'
            }
          }
        }));
      } else if (message.method === 'notifications/initialized') {
        // Acknowledge initialization complete
      } else if (message.method === 'tools/list') {
        // Respond with available tools
        console.log(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [
            {
              name: 'find_entity',
              description: 'Find the identifier(s) for a specific bioconcept using a free text query',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'The text to search for'
                  },
                  concept: {
                    type: 'string',
                    description: 'Optional: Filter by concept type (gene, disease, chemical, species, mutation)',
                    enum: ['gene', 'disease', 'chemical', 'species', 'mutation']
                  },
                  limit: {
                    type: 'integer',
                    description: 'Maximum number of results to return',
                    default: 5
                  }
                },
                required: ['query']
              }
            },
            {
              name: 'search_pubtator',
              description: 'Search for relevant PubMed/PMC articles in PubTator3 using flexible queries',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Free text, PubTator concept ID, or a relations query'
                  },
                  limit: {
                    type: 'integer',
                    description: 'Number of results to retrieve',
                    default: 10
                  }
                },
                required: ['query']
              }
            },
            {
              name: 'get_paper_text',
              description: 'Download and extract the text content from a PubMed or PMC article',
              inputSchema: {
                type: 'object',
                properties: {
                  pmids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of PubMed IDs'
                  },
                  pmcids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of PubMed Central IDs'
                  },
                  format: {
                    type: 'string',
                    description: 'Format of the returned data',
                    enum: ['pubtator', 'biocxml', 'biocjson'],
                    default: 'biocjson'
                  },
                  full: {
                    type: 'boolean',
                    description: 'Whether to retrieve full text (for PMIDs)',
                    default: false
                  }
                },
                oneOf: [
                  { required: ['pmids'] },
                  { required: ['pmcids'] }
                ]
              }
            },
            {
              name: 'find_related_entities',
              description: 'Find entities related to a given identifier via customizable relation and type filters',
              inputSchema: {
                type: 'object',
                properties: {
                  entityId: {
                    type: 'string',
                    description: 'The source entity ID'
                  },
                  relationType: {
                    type: 'string',
                    description: 'Type of relation to search for (treat, cause, cotreat, convert, compare, interact, associate, positive_correlate, negative_correlate, prevent, inhibit, stimulate, drug_interact)',
                    enum: ['treat', 'cause', 'cotreat', 'convert', 'compare', 'interact', 'associate', 'positive_correlate', 'negative_correlate', 'prevent', 'inhibit', 'stimulate', 'drug_interact']
                  },
                  targetType: {
                    type: 'string',
                    description: 'Optional: Filter by target entity type (gene, disease, chemical, variant)',
                    enum: ['gene', 'disease', 'chemical', 'variant']
                  }
                },
                required: ['entityId']
              }
            }
          ]
          }
        }));
      } else if (message.method === 'tools/call') {
        const params = message.params;
        let result;
        
        try {
          // Handle different tool calls
          switch (params.name) {
            case 'find_entity':
              result = await pubtatorClient.findEntity(params.arguments.query, params.arguments.concept, params.arguments.limit);
              break;

            case 'search_pubtator':
              result = await pubtatorClient.searchPubtator(params.arguments.query, params.arguments.limit);
              break;

            case 'get_paper_text':
              result = await pubtatorClient.getPaperText(params.arguments.pmids, params.arguments.pmcids, params.arguments.format, params.arguments.full);
              break;

            case 'find_related_entities':
              result = await pubtatorClient.findRelatedEntities(
                params.arguments.entityId,
                params.arguments.relationType,
                params.arguments.targetType
              );
              break;

            default:
              throw new Error(`Unknown tool: ${params.name}`);
          }

          // Debug: Log the raw API response (truncated)
          const resultStr = JSON.stringify(result, null, 2);
          const truncatedResult = resultStr.length > 2000 ? resultStr.substring(0, 2000) + '\n... [TRUNCATED]' : resultStr;
          console.error(`[DEBUG] Raw API response for ${params.name}:`, truncatedResult);

          // Send successful response
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          }));
        } catch (error) {
          // Send error response
          console.log(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : String(error)
            }
          }));
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  // Signal that the server is ready
  console.log(JSON.stringify({ type: 'ready' }));
}

// Start the MCP server
startMCPServer();
